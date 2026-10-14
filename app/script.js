const app = {
    dirHandle: null,
    files: [], // Array of { name, handle, size, lastModified, rotation }
    currentFile: null, // The file object currently displayed — files are identified by object, never by index
    viewMode: 'single', // 'single' or 'grid'
    selection: new Set(), // Set of file objects
    readOnlyMode: false, // When true, saving is disabled (legacy drag-drop)
    cropState: { // True while the Crop & Straighten editor owns the screen (crop.js)
        active: false
    },
    zoom: 1, // Zoom level
    panX: 0, // Pan offset X
    panY: 0, // Pan offset Y
    isPanning: false, // Is user dragging to pan
    panStartX: 0,
    panStartY: 0,
    sortMode: 'name_asc', // Default sort mode


    elements: {
        dropZone: document.getElementById('drop-zone'),
        mainInterface: document.getElementById('main-interface'),
        imageContainer: document.getElementById('image-container'),
        gridView: document.getElementById('grid-view'),
        currentImage: document.getElementById('current-image'),
        fileName: document.getElementById('file-name-text'),
        fileNameBtn: document.getElementById('file-name'),
        fileCount: document.getElementById('file-count'),
        thumbnailStrip: document.getElementById('thumbnail-strip'),
        loading: document.getElementById('loading-indicator'),
        selectionBar: document.getElementById('selection-bar'),
        selectionCount: document.getElementById('selection-count'),
        btnToggleView: document.getElementById('btn-toggle-view'),
        btnCrop: document.getElementById('btn-crop'),
        btnInfo: document.getElementById('btn-info'),
        btnMore: document.getElementById('btn-more'),
        btnFullscreen: document.getElementById('btn-fullscreen'),
        btnCustomize: document.getElementById('btn-customize'),
        headerControls: document.getElementById('header-controls'),
        customizePanel: document.getElementById('settings-panel'),
        customizeList: document.getElementById('customize-list'),
        stripResize: document.getElementById('strip-resize'),
        taskList: document.getElementById('task-list'),
        infoPanel: document.getElementById('info-panel'),
        infoList: document.getElementById('info-list'),
        statusBar: document.getElementById('status-bar'),
        loadingText: document.getElementById('loading-text'),
        gridControls: document.getElementById('grid-controls'),
        gridSizeSlider: document.getElementById('grid-size-slider'),
        sortModeSelect: document.getElementById('sort-mode'),
        btnToggleStrip: document.getElementById('btn-toggle-strip')
    },

    init() {
        // Debug
        this.log('App Initializing... v' + (typeof APP_VERSION !== 'undefined' ? APP_VERSION : 'dev'));

        // In the Windows app: what only it has, and wording for how it keeps
        // things (the Recycle Bin, storage on the PC rather than .jeditor)
        if (FolderCache.native()) {
            document.documentElement.classList.add('native');
            document.querySelectorAll('[data-native-text]').forEach(el => { el.textContent = el.dataset.nativeText; });
            document.querySelectorAll('[data-native-title]').forEach(el => { el.title = el.dataset.nativeTitle; });
        }

        // Show the version on the start screen
        this.checkForUpdateNotice();
        const title = document.getElementById('app-title');
        if (title && typeof APP_VERSION !== 'undefined') {
            // "jEditor 1.2.3": the version as a quiet badge beside the name
            title.textContent = 'jEditor ';
            const v = document.createElement('span');
            v.className = 'app-version';
            v.textContent = APP_VERSION;
            title.appendChild(v);
            document.title = 'jEditor ' + APP_VERSION; // the window's title bar
            document.getElementById('btn-whatsnew-start').textContent = `What's new in ${APP_VERSION}`;
        }

        // Drag and Drop
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            document.body.addEventListener(eventName, e => {
                e.preventDefault();
                e.stopPropagation();
            }, false);
        });

        // Files from outside only: not photos onto a folder, a toolbar
        // control being reordered in Settings, or text
        const fromOutside = (e) => !Folders.dragging && !this._dragKey &&
            !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
        document.body.addEventListener('dragenter', (e) => {
            if (!fromOutside(e)) return;
            document.body.classList.add('drag-over');
            this.log('Drag Enter');
        });
        document.body.addEventListener('dragleave', (e) => {
            if (!e.relatedTarget) {
                document.body.classList.remove('drag-over');
                this.log('Drag Leave');
            }
        });
        document.body.addEventListener('drop', (e) => {
            document.body.classList.remove('drag-over');
            if (!fromOutside(e)) return;
            this.log('Drop Event Fired!');
            this.handleDrop(e);
        });

        // Controls
        document.getElementById('btn-prev').addEventListener('click', () => this.navigate(-1));
        document.getElementById('btn-next').addEventListener('click', () => this.navigate(1));
        document.getElementById('btn-rotate-left').addEventListener('click', () => this.rotateCurrent(-90));
        document.getElementById('btn-rotate-right').addEventListener('click', () => this.rotateCurrent(90));

        // View Toggle
        this.elements.btnToggleView.addEventListener('click', () => this.toggleView());
        this.elements.btnToggleStrip.addEventListener('click', () => this.toggleThumbnailStrip());

        // Bulk Controls
        document.getElementById('btn-rotate-left-bulk').addEventListener('click', () => this.rotateBulk(-90));
        document.getElementById('btn-rotate-right-bulk').addEventListener('click', () => this.rotateBulk(90));
        document.getElementById('btn-auto-crop').addEventListener('click', () => this.batchAutoCrop([...this.selection]));
        document.getElementById('btn-move-to').addEventListener('click', (e) => Folders.openPicker([...this.selection], e.shiftKey ? 'copy' : 'move'));
        document.getElementById('btn-batch-rename').addEventListener('click', () => this.batchRename([...this.selection]));
        // ⋯ on the selection bar: the less-used actions
        document.getElementById('btn-export').addEventListener('click', (e) => {
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            this.openContextMenu(this.selectionMoreItems(), r.left, r.top - 8, { above: true });
        });
        document.getElementById('btn-trash').addEventListener('click', () => this.moveToTrash([...this.selection]));
        document.getElementById('btn-clear-selection').addEventListener('click', () => this.clearSelection());
        document.getElementById('btn-refresh').addEventListener('click', () => this.refreshFolder());

        // Crop Controls
        if (this.elements.btnCrop) this.elements.btnCrop.addEventListener('click', () => this.enterCrop());

        // File Info
        if (this.elements.btnInfo) this.elements.btnInfo.addEventListener('click', () => this.toggleInfoPanel());

        // Keyboard
        this.bindKeyboard();

        // Zoom
        this.elements.imageContainer.addEventListener('wheel', (e) => this.handleZoom(e));
        this.elements.imageContainer.addEventListener('dblclick', (e) => this.handleDoubleClickZoom(e));

        // Pan/Drag
        this.elements.imageContainer.addEventListener('mousedown', (e) => this.handlePanStart(e));
        document.addEventListener('mousemove', (e) => this.handlePanMove(e));
        document.addEventListener('mouseup', () => this.handlePanEnd());

        // Thumbnail Strip Scroll
        this.elements.thumbnailStrip.addEventListener('wheel', (e) => {
            if (e.deltaY !== 0) {
                // Translate vertical scroll to horizontal
                e.preventDefault();
                this.elements.thumbnailStrip.scrollLeft += e.deltaY;
            }
        });

        // Thumbnail Fit Toggle
        document.getElementById('btn-toggle-fit').addEventListener('click', () => this.toggleThumbnailFit());

        // Browse Folder Button (uses modern File System Access API for write support)
        document.getElementById('btn-browse-folder').addEventListener('click', () => this.browseFolder());

        // Grid Size Slider
        this.elements.gridSizeSlider.addEventListener('input', (e) => this.setGridSize(parseInt(e.target.value, 10)));
        // Off-screen tiles stand in at the real tile size (see syncGridTile)
        if (typeof ResizeObserver === 'function') new ResizeObserver(() => this.syncGridTile()).observe(this.elements.gridView);

        // Sort Control (persisted; capture-date sort loads EXIF dates first)
        this.elements.sortModeSelect.addEventListener('change', async (e) => {
            this.sortMode = e.target.value;
            try { localStorage.setItem('jeditor.sortMode', this.sortMode); } catch (err) { /* private mode */ }
            if (this.sortMode.startsWith('taken')) await this.ensureDatesTaken();
            this.sortFiles();
        });
        try {
            const saved = localStorage.getItem('jeditor.sortMode');
            if (saved && this.elements.sortModeSelect.querySelector(`option[value="${saved}"]`)) {
                this.sortMode = saved;
                this.elements.sortModeSelect.value = saved;
            }
        } catch (err) { /* private mode */ }

        // Click the file name to rename
        this.elements.fileNameBtn.addEventListener('click', () => this.promptRename());

        // Ctrl+wheel zooms the grid
        this.elements.gridView.addEventListener('wheel', (e) => {
            if (!e.ctrlKey) return;
            e.preventDefault();
            const slider = this.elements.gridSizeSlider;
            const next = Math.max(80, Math.min(400, parseInt(slider.value, 10) - Math.sign(e.deltaY) * 20));
            slider.value = next;
            this.setGridSize(next);
        }, { passive: false });

        Folders.init(this);
        Recents.init(this);
        Stored.init(this);
        Updates.init(this);
        Scan.init(this);
        Camera.init(this);
        Places.init(this);
        Windows.init(this);
        Flags.init(this);
        Edits.init(this);
        History.init(this);
        Watch.init(this);
        this.initContextMenu();
        this.initRubberBand();
        this.initShortcutsPanel();

        // Any pointer interaction stops a running slideshow
        document.addEventListener('pointerdown', () => this.stopSlideshow());

        // Header pill: More expander, fullscreen, settings
        this.elements.btnMore.addEventListener('click', () => {
            const open = this.elements.headerControls.classList.toggle('expanded');
            this.elements.btnMore.setAttribute('aria-expanded', String(open));
        });
        this.elements.btnFullscreen.addEventListener('click', () => this.toggleFullscreen());
        this.elements.btnCustomize.addEventListener('click', () => this.toggleCustomizePanel());
        document.getElementById('btn-shortcuts').addEventListener('click', () => this.toggleShortcutsPanel());
        document.getElementById('btn-whatsnew').addEventListener('click', () => this.toggleWhatsNew());
        document.getElementById('btn-whatsnew-start').addEventListener('click', () => this.toggleWhatsNew(true));
        document.getElementById('btn-shortcuts-start').addEventListener('click', () => this.toggleShortcutsPanel(true));
        document.getElementById('btn-settings-start').addEventListener('click', () => this.toggleCustomizePanel(true));
        document.getElementById('whatsnew-close').addEventListener('click', () => this.toggleWhatsNew(false));
        document.getElementById('whatsnew-panel').addEventListener('mousedown', (e) => {
            if (e.target === e.currentTarget) this.toggleWhatsNew(false);
        });
        document.getElementById('btn-dupes').addEventListener('click', () => this.openDupes());
        this.initSettings();

        this.initStripResize();
        this.initControlsAutoHide();

        // Apply saved layout (order, hidden buttons, orientation, scale,
        // strip height, thumbnail fit)
        this.loadUiPrefs();
        this.applyUiPrefs();
    },

    async verifyPermission(fileHandle, readWrite) {
        const options = {};
        if (readWrite) {
            options.mode = 'readwrite';
        }
        // Check if permission was already granted. If so, return true.
        if ((await fileHandle.queryPermission(options)) === 'granted') {
            return true;
        }
        // Request permission. If the user grants permission, return true.
        if ((await fileHandle.requestPermission(options)) === 'granted') {
            return true;
        }
        // The user didn't grant permission, so return false.
        return false;
    },

    async browseFolder() {
        try {
            // Check for File System Access API support
            if (!window.showDirectoryPicker) {
                this.showToast('Your browser does not support folder selection.');
                return;
            }

            this.log('Opening folder picker...');
            const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });

            this.log(`Folder selected: ${dirHandle.name}`);
            await this.openDirectory(dirHandle);
        } catch (err) {
            if (err.name === 'AbortError') {
                // User canceled the picker
                this.log('Folder selection canceled');
                return;
            }
            console.error('Browse folder error:', err);
            UI.alert({ title: 'Couldn\'t open the folder', message: err.message });
        }
    },

    // Open a folder with read/write access: from the picker, or a recent
    // order. A folder inside an order opened before can open as part of
    // that order instead (scope: the folder to show, see Recents.offerOrder).
    async openDirectory(dirHandle, { scope = null } = {}) {
        if (scope === null) {
            const order = await Recents.offerOrder(dirHandle);
            if (order) return this.openDirectory(order.handle, { scope: order.path });
        }
        this._openScope = scope;
        // A newer open (or drop) supersedes this one: it stops where it is
        const gen = this._openGen = (this._openGen || 0) + 1;
        this.isLoading = true;
        try {
            // Flags changed just now are written to the project being left
            // (their save is on a timer, which would otherwise run here)
            if (this.dirHandle) { try { await Flags.save(); } catch (e) { /* best-effort */ } }
            if (gen !== this._openGen) return;
            // Reset state
            this.cleanupURLs();
            this.files = [];
            this.dirHandle = dirHandle;
            this.readOnlyMode = false; // Modern API supports writing

            this.beginTask('scan', 'Scanning folder…');
            this.elements.dropZone.classList.add('hidden');

            await this.scanDirectory(dirHandle);
            if (gen !== this._openGen) return;

            await this.finalizeLoad();
        } catch (err) {
            if (gen !== this._openGen) return;
            this.isLoading = false;
            console.error('Open folder error:', err);
            UI.alert({ title: 'Couldn\'t open the folder', message: err.message });
            this.elements.dropZone.classList.remove('hidden');
            this.endTask('scan');
        }
    },

    log(msg) {
        const d = new Date();
        const time = d.toLocaleTimeString() + '.' + d.getMilliseconds();
        const line = `[${time}] ${msg}`;
        // console.log(line); // console.log is fast, we can keep it
        const el = document.getElementById('debug-log');
        if (el) {
            const div = document.createElement('div');
            div.textContent = line;
            el.appendChild(div);

            // Performance: Limit to 100 lines
            if (el.childElementCount > 100) {
                el.removeChild(el.firstChild);
            }

            // Auto scroll
            el.parentElement.scrollTop = el.parentElement.scrollHeight;
        }
    },

    // ---- UI preferences and Settings ----
    //
    // Every header control can be shown in the pill, tucked into the "More"
    // section, or hidden entirely; the order is drag-reorderable in
    // Settings. Theme, density, glass, the color behind photos, accent,
    // toolbar size, orientation, film strip height and thumbnail fit are
    // preferences too. Everything persists in localStorage under 'jeditor.ui'.

    HC_LABELS: {
        scan: 'Scan',
        camera: 'Camera (tethered shooting)',
        info: 'Info',
        view: 'Grid / single view',
        refresh: 'Rescan folder',
        crop: 'Crop and straighten',
        history: 'Undo history',
        fit: 'Thumbnail fit',
        strip: 'Film strip',
        fullscreen: 'Full screen',
        dupes: 'Find duplicates (WIP)',
        keys: 'Keyboard shortcuts',
        whatsnew: 'What\'s new',
        customize: 'Settings'
    },

    // Allowed values for the appearance settings; the first is the default
    APPEARANCE: {
        theme: ['dark', 'light', 'system'],
        density: ['compact', 'comfortable'],
        glass: ['rich', 'subtle'],
        surround: ['auto', 'black', 'grey', 'light']
    },

    defaultUiPrefs() {
        return {
            order: ['scan', 'camera', 'info', 'view', 'refresh', 'crop', 'history', 'fit', 'strip', 'fullscreen', 'dupes', 'keys', 'whatsnew', 'customize'],
            placement: { // 'main' | 'more' | 'hidden'
                scan: 'main', camera: 'main', info: 'main', view: 'main', refresh: 'main', crop: 'main', history: 'main',
                fit: 'more', strip: 'more', fullscreen: 'more', dupes: 'more', keys: 'more', whatsnew: 'more', customize: 'more'
            },
            vertical: false,
            scale: 1,
            stripHeight: 80,
            thumbContain: true, // fit whole image in tiles by default
            folderCache: true, // keep thumbnails / duplicate data with the order's data (folder-cache.js)
            autoUpdate: true, // the Windows app looks for a new version once a day
            autoCheck: true, // pick up photos added, removed or edited outside jEditor
            accent: null, // the accent colour (#rrggbb); null is the standard blue
            singleControls: true, // previous / rotate / next above the film strip in single view
            theme: 'dark',
            density: 'compact',
            glass: 'rich',
            surround: 'auto'
        };
    },

    loadUiPrefs() {
        this.uiPrefs = this.defaultUiPrefs();
        try {
            const saved = JSON.parse(localStorage.getItem('jeditor.ui') || 'null');
            if (saved) {
                if (Array.isArray(saved.order)) {
                    // keep unknown-key safety: only accept known keys, append missing
                    this.uiPrefs.order = this.mergeOrder(saved.order, this.uiPrefs.order);
                }
                if (saved.placement) {
                    for (const k of Object.keys(this.uiPrefs.placement)) {
                        if (['main', 'more', 'hidden'].includes(saved.placement[k])) {
                            this.uiPrefs.placement[k] = saved.placement[k];
                        }
                    }
                }
                if (typeof saved.vertical === 'boolean') this.uiPrefs.vertical = saved.vertical;
                if (saved.scale >= 0.8 && saved.scale <= 1.6) this.uiPrefs.scale = saved.scale;
                if (saved.stripHeight >= 50 && saved.stripHeight <= 240) this.uiPrefs.stripHeight = saved.stripHeight;
                if (typeof saved.thumbContain === 'boolean') this.uiPrefs.thumbContain = saved.thumbContain;
                if (typeof saved.folderCache === 'boolean') this.uiPrefs.folderCache = saved.folderCache;
                if (typeof saved.autoCheck === 'boolean') this.uiPrefs.autoCheck = saved.autoCheck;
                if (typeof saved.autoUpdate === 'boolean') this.uiPrefs.autoUpdate = saved.autoUpdate;
                if (typeof saved.accent === 'string' && /^#[0-9a-f]{6}$/i.test(saved.accent)) this.uiPrefs.accent = saved.accent;
                if (typeof saved.singleControls === 'boolean') this.uiPrefs.singleControls = saved.singleControls;
                if (typeof saved.folderRail === 'boolean') this.uiPrefs.folderRail = saved.folderRail;
                for (const [k, allowed] of Object.entries(this.APPEARANCE)) {
                    if (allowed.includes(saved[k])) this.uiPrefs[k] = saved[k];
                }
            }
        } catch (e) { /* corrupted prefs → defaults */ }
    },

    // A saved order of controls, with only known ones; a control added in a
    // newer version goes after the one before it in the standard order
    // (Camera after Scan), else at the end
    mergeOrder(saved, known) {
        const order = saved.filter(k => known.includes(k));
        for (const k of known) {
            if (order.includes(k)) continue;
            const i = known.indexOf(k);
            const before = i > 0 && order.includes(known[i - 1]) ? known[i - 1] : null;
            if (before) order.splice(order.indexOf(before) + 1, 0, k);
            else order.push(k);
        }
        return order;
    },

    saveUiPrefs() {
        try { localStorage.setItem('jeditor.ui', JSON.stringify(this.uiPrefs)); } catch (e) { /* private mode */ }
    },

    headerButton(key) {
        return this.elements.headerControls.querySelector(`[data-hc="${key}"]`);
    },

    applyUiPrefs() {
        const p = this.uiPrefs || (this.uiPrefs = this.defaultUiPrefs());
        const container = this.elements.headerControls;

        // Controls added in newer versions go at the end of an older layout
        p.order = this.mergeOrder(p.order, this.defaultUiPrefs().order);

        // Reorder buttons (More button stays last)
        p.order.forEach(key => {
            const btn = this.headerButton(key);
            if (btn) container.insertBefore(btn, this.elements.btnMore);
        });
        // Placement classes
        let hasMore = false;
        p.order.forEach(key => {
            const btn = this.headerButton(key);
            if (!btn) return;
            const place = p.placement[key] || 'main';
            btn.classList.toggle('hidden', place === 'hidden');
            btn.classList.toggle('hc-extra', place === 'more');
            if (place === 'more') hasMore = true;
        });
        // No overflow items → no expander
        this.elements.btnMore.classList.toggle('hidden', !hasMore);

        container.classList.toggle('vertical', !!p.vertical);
        document.documentElement.style.setProperty('--ui-scale', p.scale);
        document.documentElement.style.setProperty('--strip-height', `${p.stripHeight}px`);

        this.elements.gridView.classList.toggle('thumb-contain', !!p.thumbContain);
        this.elements.thumbnailStrip.classList.toggle('thumb-contain', !!p.thumbContain);
        document.getElementById('btn-toggle-fit').setAttribute('aria-pressed', String(!!p.thumbContain));
        this.applyAccent(p.accent);
        const controls = this.singleControls();
        if (controls) controls.classList.toggle('off', p.singleControls === false);
        this.applyAppearance();
    },

    // Theme, density, glass and the color behind photos: attributes on
    // <html> that tokens.css switches on
    applyAppearance() {
        const p = this.uiPrefs;
        const root = document.documentElement;
        if (!this._systemTheme && window.matchMedia) {
            this._systemTheme = window.matchMedia('(prefers-color-scheme: light)');
            const follow = () => { if (this.uiPrefs.theme === 'system') this.applyAppearance(); };
            if (this._systemTheme.addEventListener) this._systemTheme.addEventListener('change', follow);
        }
        const theme = p.theme === 'system'
            ? (this._systemTheme && this._systemTheme.matches ? 'light' : 'dark')
            : p.theme;
        root.dataset.theme = theme;
        root.dataset.density = p.density;
        root.dataset.glass = p.glass;
        root.dataset.surround = p.surround;
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.content = theme === 'light' ? '#e8e8e8' : '#0b0b0b';
    },

    // Everything blue follows --accent-color; text on it (--on-accent)
    // turns dark when the color is light, so it stays readable
    DEFAULT_ACCENT: '#2563eb',

    applyAccent(hex) {
        const root = document.documentElement.style;
        if (!hex) {
            root.removeProperty('--accent-color');
            root.removeProperty('--on-accent');
            return;
        }
        const n = parseInt(hex.slice(1), 16);
        const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
        const lum = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
        root.setProperty('--accent-color', hex);
        root.setProperty('--on-accent', lum > 0.45 ? '#111' : '#fff');
    },

    setAccent(hex) {
        this.uiPrefs.accent = !hex || hex.toLowerCase() === this.DEFAULT_ACCENT ? null : hex.toLowerCase();
        this.saveUiPrefs();
        this.applyAccent(this.uiPrefs.accent);
        this.syncAccentPicker();
    },

    syncAccentPicker() {
        const cur = (this.uiPrefs.accent || this.DEFAULT_ACCENT).toLowerCase();
        let preset = false;
        document.querySelectorAll('#cust-accent [data-accent]').forEach(b => {
            const on = b.dataset.accent === cur;
            if (on) preset = true;
            b.classList.toggle('active', on);
            b.setAttribute('aria-checked', String(on));
        });
        const pick = document.getElementById('cust-accent-pick');
        pick.value = cur;
        pick.parentElement.classList.toggle('active', !preset);
        pick.parentElement.style.setProperty('--sw', cur);
    },

    // ---- The Settings window ----

    initSettings() {
        const $ = (id) => document.getElementById(id);
        const panel = $('settings-panel');
        $('settings-close').addEventListener('click', () => this.toggleCustomizePanel(false));
        $('settings-done').addEventListener('click', () => this.toggleCustomizePanel(false));
        panel.addEventListener('mousedown', (e) => {
            if (e.target === panel) this.toggleCustomizePanel(false);
        });
        panel.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' || this._recordingKey) return;
            e.preventDefault();
            e.stopPropagation();
            this.toggleCustomizePanel(false);
        });

        // Appearance: one radio group per setting, applied as you pick
        for (const key of Object.keys(this.APPEARANCE)) {
            panel.querySelectorAll(`input[name="set-${key}"]`).forEach(r => r.addEventListener('change', () => {
                if (!r.checked) return;
                this.uiPrefs[key] = r.value;
                this.saveUiPrefs();
                this.applyAppearance();
            }));
        }
        $('cust-accent').addEventListener('click', (e) => {
            const b = e.target.closest('[data-accent]');
            if (b) this.setAccent(b.dataset.accent);
        });
        $('cust-accent-pick').addEventListener('input', (e) => this.setAccent(e.target.value));
        $('cust-scale').addEventListener('input', (e) => {
            this.uiPrefs.scale = parseFloat(e.target.value);
            $('cust-scale-out').textContent = `${Math.round(this.uiPrefs.scale * 100)}%`;
            this.saveUiPrefs();
            this.applyUiPrefs();
        });

        // Folder
        $('cust-auto-check').addEventListener('change', (e) => {
            this.uiPrefs.autoCheck = e.target.checked;
            this.saveUiPrefs();
            if (e.target.checked) Watch.start();
            else Watch.stop();
        });
        $('cust-folder-cache').addEventListener('change', (e) => {
            this.uiPrefs.folderCache = e.target.checked;
            this.saveUiPrefs();
        });
        $('cust-cleanup').addEventListener('click', () => {
            this.toggleCustomizePanel(false);
            this.cleanUpFolder();
        });
        $('cust-stored').addEventListener('click', () => {
            this.toggleCustomizePanel(false);
            Stored.open();
        });

        // Toolbar buttons
        $('cust-single-controls').addEventListener('change', (e) => {
            this.uiPrefs.singleControls = e.target.checked;
            this.saveUiPrefs();
            this.applyUiPrefs();
            if (e.target.checked && this.viewMode === 'single') this.showControls(false);
        });
        $('cust-vertical').addEventListener('change', (e) => {
            this.uiPrefs.vertical = e.target.checked;
            this.saveUiPrefs();
            this.applyUiPrefs();
        });
        $('cust-reset').addEventListener('click', () => {
            const d = this.defaultUiPrefs();
            Object.assign(this.uiPrefs, { order: d.order, placement: d.placement, vertical: d.vertical });
            this.saveUiPrefs();
            this.applyUiPrefs();
            this.renderCustomizePanel();
        });
        $('cust-shortcuts').addEventListener('click', () => {
            this.toggleCustomizePanel(false);
            this.toggleShortcutsPanel(true);
        });
    },

    isSettingsOpen() {
        return !this.elements.customizePanel.classList.contains('hidden');
    },

    // Opens or closes Settings (the name is from when it was a small
    // "Customize" panel under the header)
    toggleCustomizePanel(force = null) {
        const panel = this.elements.customizePanel;
        const open = force !== null ? force : panel.classList.contains('hidden');
        panel.classList.toggle('hidden', !open);
        this.elements.headerControls.classList.remove('expanded');
        if (open) this.renderCustomizePanel();
    },

    renderCustomizePanel() {
        const $ = (id) => document.getElementById(id);
        const list = this.elements.customizeList;
        list.innerHTML = '';
        for (const key of Object.keys(this.APPEARANCE)) {
            const r = this.elements.customizePanel.querySelector(`input[name="set-${key}"][value="${this.uiPrefs[key]}"]`);
            if (r) r.checked = true;
        }
        $('cust-vertical').checked = !!this.uiPrefs.vertical;
        $('cust-folder-cache').checked = this.uiPrefs.folderCache !== false;
        $('cust-auto-check').checked = this.uiPrefs.autoCheck !== false;
        $('cust-cleanup').disabled = !this.dirHandle;
        $('cust-single-controls').checked = this.uiPrefs.singleControls !== false;
        this.syncAccentPicker();
        $('cust-scale').value = this.uiPrefs.scale;
        $('cust-scale-out').textContent = `${Math.round(this.uiPrefs.scale * 100)}%`;

        this.uiPrefs.order.forEach(key => {
            if ((key === 'scan' || key === 'camera') && !FolderCache.native()) return; // the Windows app only
            const li = document.createElement('li');
            li.draggable = true;
            li.dataset.key = key;

            const grip = document.createElement('span');
            grip.className = 'cust-grip';
            grip.innerHTML = '<svg class="i sm" viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1" fill="currentColor"/><circle cx="15" cy="6" r="1" fill="currentColor"/><circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/><circle cx="9" cy="18" r="1" fill="currentColor"/><circle cx="15" cy="18" r="1" fill="currentColor"/></svg>';
            const name = document.createElement('span');
            name.className = 'cust-name';
            name.textContent = this.HC_LABELS[key] || key;
            const sel = document.createElement('select');
            sel.className = 'field sm';
            sel.setAttribute('aria-label', `Where ${this.HC_LABELS[key] || key} goes`);
            [['main', 'Toolbar'], ['more', 'Under More'], ['hidden', 'Hidden']].forEach(([v, l]) => {
                const o = document.createElement('option');
                o.value = v;
                o.textContent = l;
                sel.appendChild(o);
            });
            sel.value = this.uiPrefs.placement[key] || 'main';
            sel.onchange = () => {
                this.uiPrefs.placement[key] = sel.value;
                this.saveUiPrefs();
                this.applyUiPrefs();
            };

            li.appendChild(grip);
            li.appendChild(name);
            li.appendChild(sel);

            // Keyboard: Alt+↑ / Alt+↓ moves the focused row
            li.tabIndex = 0;
            li.addEventListener('keydown', (e) => {
                if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
                e.preventDefault();
                const order = this.uiPrefs.order;
                const from = order.indexOf(key);
                const to = from + (e.key === 'ArrowUp' ? -1 : 1);
                if (to < 0 || to >= order.length) return;
                order.splice(from, 1);
                order.splice(to, 0, key);
                this.saveUiPrefs();
                this.applyUiPrefs();
                this.renderCustomizePanel();
                const moved = this.elements.customizeList.querySelector(`li[data-key="${key}"]`);
                if (moved) moved.focus();
            });
            li.addEventListener('dragstart', (e) => {
                this._dragKey = key;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', key);
            });
            li.addEventListener('dragend', () => { this._dragKey = null; });
            li.addEventListener('dragover', (e) => e.preventDefault());
            li.addEventListener('drop', (e) => {
                e.preventDefault();
                if (!this._dragKey || this._dragKey === key) return;
                const order = this.uiPrefs.order;
                order.splice(order.indexOf(this._dragKey), 1);
                order.splice(order.indexOf(key), 0, this._dragKey);
                this._dragKey = null;
                this.saveUiPrefs();
                this.applyUiPrefs();
                this.renderCustomizePanel();
            });

            list.appendChild(li);
        });
    },

    // ---- Film strip resize (drag the top edge) ----

    initStripResize() {
        const handle = this.elements.stripResize;
        if (!handle) return;
        let startY = 0, startH = 0, dragging = false;
        handle.addEventListener('mousedown', (e) => {
            dragging = true;
            startY = e.clientY;
            startH = this.uiPrefs.stripHeight;
            document.body.style.cursor = 'ns-resize';
            e.preventDefault();
        });
        window.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            this.setStripHeight(startH + (startY - e.clientY));
        });
        window.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            document.body.style.cursor = '';
            this.saveUiPrefs();
        });
    },

    setStripHeight(px) {
        this.uiPrefs.stripHeight = Math.max(50, Math.min(240, Math.round(px)));
        document.documentElement.style.setProperty('--strip-height', `${this.uiPrefs.stripHeight}px`);
    },

    toggleThumbnailFit() {
        this.uiPrefs.thumbContain = !this.uiPrefs.thumbContain;
        this.saveUiPrefs();
        this.applyUiPrefs();
    },

    // ---- Task registry ----
    //
    // Every background job registers here. The pill (top-right) shows a
    // spinner plus the most recent task; hovering it lists every task.

    beginTask(key, label) {
        if (!this._tasks) this._tasks = new Map();
        this._tasks.delete(key); // re-inserting moves it to "most recent"
        this._tasks.set(key, label);
        this.renderTasks();
    },

    updateTask(key, label) {
        if (this._tasks && this._tasks.has(key)) {
            this._tasks.set(key, label);
            this.renderTasks();
        } else {
            this.beginTask(key, label);
        }
    },

    endTask(key) {
        if (this._tasks && this._tasks.delete(key)) this.renderTasks();
    },

    renderTasks() {
        const pill = this.elements.loading;
        const labelEl = this.elements.loadingText;
        const labels = [...(this._tasks || new Map()).values()];
        if (labels.length === 0) {
            pill.classList.add('hidden');
            return;
        }
        pill.classList.remove('hidden');
        const current = labels[labels.length - 1];
        labelEl.textContent = labels.length > 1 ? `${current} (+${labels.length - 1})` : current;

        const list = this.elements.taskList;
        if (list) {
            list.innerHTML = '';
            labels.forEach(l => {
                const row = document.createElement('div');
                row.className = 'task-row';
                const spin = document.createElement('span');
                spin.className = 'task-spinner';
                const txt = document.createElement('span');
                txt.textContent = l;
                row.appendChild(spin);
                row.appendChild(txt);
                list.appendChild(row);
            });
        }
    },

    // ---- Single view: the controls above the film strip fade away ----
    //
    // A few seconds after they're shown, so the photo has the screen to
    // itself. They come back while the pointer is on or near where they
    // sit (or a button has keyboard focus), and fade again once it leaves.
    // Customize controls can turn them off altogether (uiPrefs.singleControls).

    CONTROLS_IDLE_MS: 2500,
    CONTROLS_NEAR_PX: 48,

    singleControls() {
        return this.elements.thumbnailStrip.parentElement.querySelector('.controls');
    },

    initControlsAutoHide() {
        const el = this.singleControls();
        if (!el) return;
        document.addEventListener('pointermove', (e) => {
            if (this.viewMode !== 'single' || el.classList.contains('hidden') || el.classList.contains('off')) return;
            const r = el.getBoundingClientRect(), pad = this.CONTROLS_NEAR_PX;
            const near = e.clientX >= r.left - pad && e.clientX <= r.right + pad &&
                e.clientY >= r.top - pad && e.clientY <= r.bottom + pad;
            if (near) this.showControls();
            else if (this._controlsHeld) this.idleControls();
        }, { passive: true });
        // Touch: a tap on the photo brings them back for a while
        this.elements.imageContainer.addEventListener('pointerdown', (e) => {
            if (e.pointerType !== 'mouse' && this.viewMode === 'single') this.showControls(false);
        });
        el.addEventListener('focusin', () => this.showControls());
        el.addEventListener('focusout', () => this.idleControls());
    },

    // hold: stay up until idleControls (pointer near); otherwise fade later
    showControls(hold = true) {
        const el = this.singleControls();
        if (!el) return;
        el.classList.remove('idle');
        clearTimeout(this._controlsTimer);
        this._controlsHeld = hold;
        if (!hold) this.idleControls();
    },

    idleControls() {
        this._controlsHeld = false;
        clearTimeout(this._controlsTimer);
        this._controlsTimer = setTimeout(() => {
            const el = this.singleControls();
            if (el && !el.contains(document.activeElement)) el.classList.add('idle');
        }, this.CONTROLS_IDLE_MS);
    },

    toggleThumbnailStrip() {
        const strip = this.elements.thumbnailStrip;
        const show = strip.classList.contains('hidden');
        strip.classList.toggle('hidden', !show);
        if (this.elements.stripResize) this.elements.stripResize.classList.toggle('hidden', !show);
        this.elements.btnToggleStrip.setAttribute('aria-pressed', String(show));
        this.elements.btnToggleStrip.blur(); // Release focus to restore keyboard shortcuts
    },

    // Wheel / trackpad pinch: each notch zooms by the same factor, centered
    // on the pointer, from 10% of fit up to huge pixels
    handleZoom(e) {
        if (this.viewMode !== 'single') return;
        if (this.cropState.active) return; // Disable zoom while cropping
        e.preventDefault();
        let dy = e.deltaY;
        if (e.deltaMode === 1) dy *= 16;       // lines
        else if (e.deltaMode === 2) dy *= 400; // pages
        dy = Math.max(-300, Math.min(300, dy));
        this.zoomTo(this.zoom * Math.exp(-dy * 0.002), e.clientX, e.clientY);
    },

    // ---- Zoom ----
    //
    // this.zoom is relative to fit (1 = the whole photo on screen). It goes
    // up to 3200% of the photo's own pixels, like Photoshop. Past 100% the
    // pixels are drawn as sharp squares, never smoothed; below it, scaling
    // down is smoothed (otherwise fine detail shimmers).

    MAX_PIXEL_ZOOM: 32,  // screen pixels per photo pixel, at most
    PIXELATED_FROM: 1,   // sharp pixels as soon as they're bigger than screen pixels

    // The zoom at which one photo pixel is one screen pixel (0 if unknown).
    // Measured on the image on screen, which is always the right way round
    // (a size remembered from before a rotation may not be); a screen-sized
    // preview is scaled up by how much bigger the original is.
    oneToOneZoom() {
        const img = this.elements.currentImage, f = this.currentFile;
        if (!f || this._displayFile !== f || !img.offsetWidth || !img.naturalWidth) return 0;
        let originalPerShown = 1;
        if (!this.showingOriginal()) {
            if (!f._dims) return 0;
            originalPerShown = Math.max(f._dims.w, f._dims.h) / Math.max(img.naturalWidth, img.naturalHeight);
        }
        return img.naturalWidth * originalPerShown / (img.offsetWidth * this.currentFitScale());
    },

    // The original file's pixels are on screen (not a preview or thumbnail)
    showingOriginal() {
        return this._displayKind === 'full' && !this.elements.currentImage._isPreview;
    },

    maxZoom() {
        return Math.max(8, (this.oneToOneZoom() || 1) * this.MAX_PIXEL_ZOOM);
    },

    // Zoom to `target`, keeping the screen point (x, y) where it is; the
    // middle of the view when no point is given
    zoomTo(target, x = null, y = null) {
        if (this.viewMode !== 'single' || this.cropState.active || !this.currentFile) return;
        const img = this.elements.currentImage;
        const box = this.elements.imageContainer.getBoundingClientRect();
        if (x === null) { x = box.left + box.width / 2; y = box.top + box.height / 2; }
        target = Math.max(0.1, Math.min(this.maxZoom(), target));
        if (target <= 1) {
            this.zoom = target;
            this.panX = 0;
            this.panY = 0;
        } else if (img.offsetWidth) {
            // Where the photo's center is: the container centers it, plus the
            // pan. Worked out rather than measured, so a zoom still animating
            // can't throw the anchor off (and exact to the subpixel)
            const cx = box.left + box.width / 2 + this.panX;
            const cy = box.top + box.height / 2 + this.panY;
            const s = this.zoom * this.currentFitScale();
            const hw = img.offsetWidth * s / 2, hh = img.offsetHeight * s / 2;
            const dx = Math.max(-hw, Math.min(hw, x - cx)), dy = Math.max(-hh, Math.min(hh, y - cy));
            const k = target / this.zoom;
            this.panX += dx * (1 - k);
            this.panY += dy * (1 - k);
            this.zoom = target;
        }
        this.elements.imageContainer.style.cursor = this.zoom > 1 ? 'grab' : 'default';
        this.updateImageTransform();
        if (this.zoom > 1) this.ensureFullRes();
        this.showZoomLevel();
    },

    // A brief readout of the zoom: % of the photo's own pixels
    showZoomLevel() {
        const el = document.getElementById('zoom-level');
        if (!el) return;
        const one = this.oneToOneZoom();
        el.textContent = Math.abs(this.zoom - 1) < 0.005 ? 'Fit'
            : one ? `${Math.round(this.zoom / one * 100)}%` : `${this.zoom.toFixed(1)}×`;
        el.classList.add('visible');
        clearTimeout(this._zoomLevelTimer);
        this._zoomLevelTimer = setTimeout(() => el.classList.remove('visible'), 900);
    },

    // Double-click: at fit, zoom in to 100% (one photo pixel per screen
    // pixel, at least 2×) on the spot clicked; zoomed in or out, back to fit
    handleDoubleClickZoom(e) {
        if (this.viewMode !== 'single' || this.cropState.active || !this.currentFile) return;
        if (e.target.closest && e.target.closest('button, input, select, a')) return;
        const img = this.elements.currentImage;
        if (!img.offsetWidth) return;
        e.preventDefault();
        if (window.getSelection) window.getSelection().removeAllRanges();

        // At fit: in to 100% (at least 2×) on the spot clicked; otherwise back to fit
        const target = Math.abs(this.zoom - 1) < 0.01 ? Math.max(2, this.oneToOneZoom() || 2.5) : 1;

        // A gentler transition than the wheel's for the big jump
        img.classList.add('zoom-animate');
        clearTimeout(this._zoomAnimTimer);
        this._zoomAnimTimer = setTimeout(() => img.classList.remove('zoom-animate'), 260);
        this.zoomTo(target, e.clientX, e.clientY);
    },

    // CSS rotation on the photo: rotation saved to disk after these pixels
    // were read, plus what is still being written or queued
    currentCssRotation() {
        const img = this.elements.currentImage;
        const f = this.currentFile;
        const readAt = this._displayFile === f && img._savedAtRead !== undefined
            ? img._savedAtRead : (f._savedRotationTotal || 0);
        return ((f._savedRotationTotal || 0) - readAt) + (f.savingRotation || 0) + (f.pendingRotation || 0);
    },

    // At odd quarter-turns the CSS-rotated image would overflow the
    // container (layout still sees the unrotated box): the scale that fits it
    currentFitScale(r = this.currentCssRotation()) {
        const img = this.elements.currentImage;
        if (((r % 180) + 180) % 180 !== 90) return 1;
        const cw = this.elements.imageContainer.clientWidth;
        const ch = this.elements.imageContainer.clientHeight;
        const w = img.offsetWidth, h = img.offsetHeight;
        return cw && ch && w && h ? Math.min(cw / h, ch / w) : 1;
    },

    updateImageTransform() {
        if (!this.currentFile) return;
        const r = this.currentCssRotation();
        // Past 100%, the original's pixels as sharp squares (a preview
        // standing in until the original loads stays smooth)
        const img = this.elements.currentImage;
        const one = this.showingOriginal() ? this.oneToOneZoom() : 0;
        img.classList.toggle('pixelated', one > 0 && this.zoom / one > this.PIXELATED_FROM + 1e-6);
        this.elements.currentImage.style.transform =
            `translate(${this.panX}px, ${this.panY}px) rotate(${r}deg) scale(${this.zoom * this.currentFitScale(r)})`;
    },

    handlePanStart(e) {
        if (this.viewMode !== 'single') return;
        if (this.cropState.active) return;
        if (this.zoom <= 1) return; // Only pan when zoomed in

        // Prevent default to avoid text selection
        e.preventDefault();

        this.isPanning = true;
        this.panStartX = e.clientX - this.panX;
        this.panStartY = e.clientY - this.panY;
        this.elements.imageContainer.style.cursor = 'grabbing';
    },

    handlePanMove(e) {
        if (!this.isPanning) return;

        this.panX = e.clientX - this.panStartX;
        this.panY = e.clientY - this.panStartY;
        this.updateImageTransform();
    },

    handlePanEnd() {
        if (!this.isPanning) return;
        this.isPanning = false;
        this.elements.imageContainer.style.cursor = this.zoom > 1 ? 'grab' : 'default';
    },

    resetPan() {
        this.panX = 0;
        this.panY = 0;
        this.zoom = 1;
    },

    async handleDrop(e) {
        document.body.classList.remove('drag-over');
        e.preventDefault();

        try {
            this.log('Entering handleDrop...');

            // Safety reset
            if (this.isLoading) this.isLoading = false;
            this.isLoading = true;
            this._openGen = (this._openGen || 0) + 1; // an open in progress stops

            this.cleanupURLs();
            this.files = [];
            this.dirHandle = null;

            this.beginTask('scan', 'Loading dropped items…');

            if (this.elements.dropZone) {
                this.elements.dropZone.classList.add('hidden');
            }

            const items = [...e.dataTransfer.items];
            if (!items || items.length === 0) throw new Error('No items dropped.');

            this.updateTask('scan', `Processing ${items.length} items…`);
            this.log(`Processing ${items.length} items...`);

            // Try modern File System Access API first (supports writing)
            // Capture all handles/entries synchronously before DataTransfer expires
            const handlePromises = items.map(item => {
                if (item.kind !== 'file') return null;
                // Try modern API first
                if (typeof item.getAsFileSystemHandle === 'function') return item.getAsFileSystemHandle();
                // Fallback to legacy
                return Promise.resolve(item.webkitGetAsEntry());
            }).filter(p => p !== null);

            const droppedHandles = await Promise.all(handlePromises);

            for (const handle of droppedHandles) {
                if (!handle) continue;
                try {
                    // Check if it's a modern FileSystemHandle
                    if (handle.kind === 'directory') {
                        // Part of an order opened before? Maybe open that instead
                        const order = droppedHandles.length === 1 && await Recents.offerOrder(handle);
                        if (order) {
                            this.endTask('scan');
                            await this.openDirectory(order.handle, { scope: order.path });
                            return;
                        }
                        // Request persistent permission immediately to avoid per-file prompts
                        await this.verifyPermission(handle, true);
                        this.dirHandle = handle;
                        this.readOnlyMode = false;
                        await this.scanDirectory(handle);
                    } else if (handle.kind === 'file') {
                        this.readOnlyMode = false;
                        if (this.isImage(handle.name)) {
                            // Capture metadata so date/size sorting works for loose files
                            const fileData = await handle.getFile();
                            this.files.push({
                                name: handle.name,
                                handle: handle,
                                size: fileData.size,
                                lastModified: fileData.lastModified
                            });
                        }
                    }
                    // Check if it's a legacy FileSystemEntry
                    else if (handle.isDirectory) {
                        this.readOnlyMode = true;
                        await this.scanEntryLegacy(handle);
                    } else if (handle.isFile) {
                        this.readOnlyMode = true;
                        await this.scanFileEntryLegacy(handle);
                    }
                } catch (err) {
                    this.log('Drop item error: ' + err.message);
                }
            }

            await this.finalizeLoad();

        } catch (err) {
            console.error('Drop error:', err);
            UI.alert({ title: 'Couldn\'t open what was dropped', message: err.message });
            this.elements.dropZone.classList.remove('hidden');
            this.endTask('scan');
        } finally {
            this.isLoading = false;
        }
    },

    async finalizeLoad() {
        try {
            // Sort initial files
            this.sortFiles(false); // pass false to avoid re-rendering twice
            // Edits kept until saved: the thumbnails are made with them
            await Edits.loadFor(1500);

            if (this.files.length > 0) {
                this.showToast(`Loaded ${this.files.length.toLocaleString()} photo${this.files.length === 1 ? '' : 's'}`, 2500);
                this.elements.mainInterface.classList.remove('hidden');

                // Force focus settings
                this.elements.mainInterface.setAttribute('tabindex', '-1');
                this.elements.mainInterface.focus();

                this.renderThumbnails();
                this.renderGrid(); // Prepare grid
                // setView shows the right container and loads the photo;
                // calling loadFile alone left #image-container hidden, so a
                // freshly opened folder showed a blank screen.
                this.selection.clear();
                this.currentFile = this.files[0];
                // Opened as part of an order: the grid, at the folder picked
                const scope = this._openScope;
                this._openScope = null;
                if (scope !== null && scope !== undefined && Folders.map.has(scope)) {
                    this.viewMode = 'grid';
                    Folders.lastScope = scope;
                    Folders.scope = scope;
                    this.currentFile = Folders.viewFiles()[0] || this.files[0];
                    if (!Folders.inView(this.currentFile)) Folders.scope = null;
                    this.renderThumbnails();
                    this.renderGrid();
                }
                this.setView(this.viewMode);

                // Warm the entire preview cache in the background so grid
                // scrolling only ever hits already-generated thumbnails
                this.precacheThumbnails();

                // Top of Recent on the start screen
                if (this.dirHandle && !this.readOnlyMode) Recents.remember(this.dirHandle);

                // Flags saved with the order, then keep an eye on the folder
                await Flags.load();
                Watch.start();
                const nested = this._nestedJeditor || [];
                this._nestedJeditor = null;
                if (nested.length && this.dirHandle && !this.readOnlyMode) FolderCache.absorbNested(this, nested);
            } else if (this.dirHandle && !this.readOnlyMode) {
                // No photos yet: it opens anyway, to scan into, make folders
                // in, or fill from elsewhere (they show up as they land)
                this._openScope = null;
                this.selection.clear();
                this.currentFile = null;
                this.elements.mainInterface.classList.remove('hidden');
                this.elements.mainInterface.setAttribute('tabindex', '-1');
                this.elements.mainInterface.focus();
                this.renderThumbnails();
                this.renderGrid();
                this.setView('grid');
                Folders.showEmptyHeader();
                Recents.remember(this.dirHandle);
                await Flags.load();
                Watch.start();
            } else {
                UI.alert({
                    title: 'No photos found',
                    message: 'There are no JPEG, PNG, WebP or GIF files in that folder or its subfolders. Choose another folder.'
                });
                this.elements.dropZone.classList.remove('hidden');
            }
        } catch (err) {
            console.error('Error finalizing load:', err);
            UI.alert({ title: 'Something went wrong opening the folder', message: String(err.message || err) });
            this.elements.dropZone.classList.remove('hidden');
        } finally {
            this.endTask('scan');
            this.isLoading = false;
        }
    },

    async scanEntryLegacy(entry) {
        if (entry.isFile) {
            await this.scanFileEntryLegacy(entry);
        } else if (entry.isDirectory) {
            const reader = entry.createReader();
            const readEntries = () => new Promise((resolve, reject) => {
                reader.readEntries(resolve, reject);
            });

            try {
                let entries = [];
                let batch = await readEntries();
                while (batch.length > 0) {
                    entries = entries.concat(batch);
                    batch = await readEntries();
                }

                for (const child of entries) {
                    await this.scanEntryLegacy(child);
                }
            } catch (err) {
                console.warn('Error reading legacy dir:', err);
            }
        }
    },

    async scanFileEntryLegacy(entry) {
        if (!this.isImage(entry.name)) return;
        try {
            // Await metadata so files are registered BEFORE the initial sort/render
            const fileData = await new Promise((resolve, reject) => entry.file(resolve, reject));
            const wrapper = {
                kind: 'file',
                name: entry.name,
                size: fileData.size,
                lastModified: fileData.lastModified,
                getFile: () => new Promise((resolve, reject) => entry.file(resolve, reject)),
                createWritable: async () => {
                    throw new Error('Saving not supported in legacy mode. Please Use a modern browser or Drop Folder again.');
                }
            };
            this.files.push({
                name: entry.name,
                handle: wrapper,
                size: fileData.size,
                lastModified: fileData.lastModified
            });
        } catch (err) {
            this.log('Legacy metadata error: ' + err.message);
        }
    },

    // Load every photo in the folder and the folders inside it. Folders are
    // listed several at a time (see Watch.walk), which matters most on a
    // network drive where each listing is a round trip.
    async scanDirectory(dirHandle) {
        // Another folder opened meanwhile: this one stops adding photos
        const gen = this._openGen;
        // Paths already loaded, so nothing is added twice
        const seen = new Set(this.files.map(f => f.relPath || f.name));
        this.updateTask('scan', 'Scanning folder…');
        const listings = await Watch.walk([{ path: '', handle: dirHandle }], true);
        if (gen !== this._openGen) return;
        const pending = [];
        // A subfolder opened on its own before has a .jeditor of its own:
        // merged into the order's once the folder is open (finalizeLoad). In
        // the Windows app the order's own .jeditor goes too: its contents
        // move into the app's storage on the PC (folder-cache.js).
        this._nestedJeditor = [];
        for (const [dir, l] of listings) {
            if (!l || l.failed) continue;
            if ((dir || FolderCache.native()) && l.own && l.own.length) this._nestedJeditor.push({ path: dir, parent: l.handle, handles: l.own });
            Folders.register(dir, l.handle);
            for (const [name, entry] of l.files) {
                const relPath = Folders.join(dir, name);
                if (seen.has(relPath)) continue;
                seen.add(relPath);
                pending.push({ entry, relPath, parentDir: l.handle });
            }
        }
        // Size and date, read several at a time
        const BATCH = 32;
        for (let i = 0; i < pending.length; i += BATCH) {
            const batch = pending.slice(i, i + BATCH);
            const datas = await Promise.all(batch.map(p => p.entry.getFile().catch(() => null)));
            // A photo a scanner is writing right now is left for the folder
            // watch to add once it's whole (only just-changed files are checked)
            const whole = await Promise.all(datas.map((d, j) => d && Date.now() - d.lastModified < Watch.SETTLED_MS
                ? Watch.complete(d, batch[j].entry.name) : true));
            if (gen !== this._openGen) return;
            batch.forEach(({ entry, relPath, parentDir }, j) => {
                const fileData = datas[j];
                if (!fileData || !whole[j]) return;
                this.files.push({
                    name: entry.name,
                    relPath,
                    parentDir,
                    handle: entry,
                    size: fileData.size,
                    lastModified: fileData.lastModified
                });
            });
            this.updateTask('scan', `Scanning folder… ${this.files.length} images`);
        }
    },

    // R: new photos come in, photos removed elsewhere go, edited ones are
    // updated (see watch.js)
    async refreshFolder() {
        if (!this.dirHandle) return;
        this.log('Manual Refresh Started');
        await Watch.rescan();
    },

    // Legacy drag-and-drop gives read-only files. Say so up front instead
    // of letting an edit run and fail at the save.
    ensureWritable() {
        if (!this.readOnlyMode) return true;
        this.showToast('These photos were opened read-only — use Open folder to edit and save', 4000);
        return false;
    },

    isImage(name) {
        return /\.(jpg|jpeg|png|webp|gif)$/i.test(name);
    },

    // Position of the current photo among the ones being shown (one
    // folder's, or all of them)
    getCurrentIndex() {
        return this.viewFiles().indexOf(this.currentFile);
    },

    // The photos the grid, film strip and arrow keys go through
    viewFiles() {
        return Folders.viewFiles();
    },

    // "3 / 48" in the header
    updateFileCount() {
        const view = this.viewFiles();
        const i = view.indexOf(this.currentFile);
        this.elements.fileCount.textContent = i === -1 ? `${view.length.toLocaleString()} photos` : `${i + 1} / ${view.length}`;
    },

    // Degrees of CSS rotation a thumbnail needs on top of its cached bitmap:
    // rotation already saved to disk but not baked into that bitmap (lag),
    // plus rotation currently being written, plus rotation still queued.
    // (The single view tracks the same per displayed element — see
    // updateImageTransform.)
    getDisplayRotation(file, kind = 'thumb') {
        if (!file) return 0;
        return (file.thumbLag || 0) + (file.savingRotation || 0) + (file.pendingRotation || 0);
    },

    // ---- File info ----

    // Full display path of a file: root folder + relative path when known
    getDisplayPath(file) {
        if (!file) return '';
        const rel = file.relPath || file.name;
        return this.dirHandle ? `${this.dirHandle.name}/${rel}` : rel;
    },

    // Subtle chip in the bottom-left with location + file name (single
    // view only: the grid has the folder list and the folder pill)
    updateStatusBar() {
        const el = this.elements.statusBar;
        if (!el) return;
        if (!this.currentFile || this.viewMode === 'grid') {
            el.classList.add('hidden');
            return;
        }
        el.classList.remove('hidden');
        el.textContent = this.getDisplayPath(this.currentFile) + (this.readOnlyMode ? ' · read-only' : '');
    },

    formatBytes(n) {
        if (!(n >= 0)) return '—';
        if (n < 1024) return `${n} B`;
        if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
        if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n < 100 * 1024 * 1024 ? 2 : 1)} MB`;
        return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    },

    // Read Make / Model / DateTimeOriginal from a JPEG's EXIF block.
    // Returns { make, model, dateTaken: Date|null } or null.
    readJpegExifInfo(buffer) {
        try {
            const view = new DataView(buffer);
            if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8) return null;

            let offset = 2;
            let tiff = -1;
            while (offset + 4 <= view.byteLength) {
                const marker = view.getUint16(offset);
                if ((marker & 0xFF00) !== 0xFF00 || marker === 0xFFDA || marker === 0xFFD9) break;
                const size = view.getUint16(offset + 2);
                if (size < 2) break;
                if (marker === 0xFFE1 && offset + 10 <= view.byteLength &&
                    view.getUint32(offset + 4) === 0x45786966 && view.getUint16(offset + 8) === 0) {
                    tiff = offset + 10;
                    break;
                }
                offset += 2 + size;
            }
            if (tiff === -1) return null;

            const bo = view.getUint16(tiff);
            const le = bo === 0x4949;
            if (!le && bo !== 0x4D4D) return null;
            if (view.getUint16(tiff + 2, le) !== 0x002A) return null;

            const readAscii = (entry) => {
                const count = view.getUint32(entry + 4, le);
                if (count === 0 || count > 512) return null;
                const at = count <= 4 ? entry + 8 : tiff + view.getUint32(entry + 8, le);
                if (at + count > view.byteLength) return null;
                let s = '';
                for (let i = 0; i < count; i++) {
                    const c = view.getUint8(at + i);
                    if (c === 0) break;
                    s += String.fromCharCode(c);
                }
                return s.trim() || null;
            };

            const scanIfd = (ifd, wanted, out) => {
                if (ifd + 2 > view.byteLength) return;
                const count = view.getUint16(ifd, le);
                for (let i = 0; i < count; i++) {
                    const entry = ifd + 2 + i * 12;
                    if (entry + 12 > view.byteLength) return;
                    const tag = view.getUint16(entry, le);
                    if (wanted.includes(tag)) out[tag] = entry;
                }
            };

            const ifd0 = {};
            scanIfd(tiff + view.getUint32(tiff + 4, le), [0x010F, 0x0110, 0x8769], ifd0);

            const result = {
                make: ifd0[0x010F] ? readAscii(ifd0[0x010F]) : null,
                model: ifd0[0x0110] ? readAscii(ifd0[0x0110]) : null,
                dateTaken: null
            };

            if (ifd0[0x8769]) {
                const exifIfd = {};
                scanIfd(tiff + view.getUint32(ifd0[0x8769] + 8, le), [0x9003], exifIfd);
                if (exifIfd[0x9003]) {
                    const raw = readAscii(exifIfd[0x9003]); // "YYYY:MM:DD HH:MM:SS"
                    const m = raw && raw.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
                    // "0000:00:00 00:00:00" is a camera with no clock set: no date
                    if (m && +m[1] >= 1900 && +m[2] >= 1 && +m[3] >= 1) result.dateTaken = new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
                }
            }
            return result;
        } catch (e) {
            return null;
        }
    },

    // EXIF metadata cached per file; only the file head is read
    async getExifInfo(file) {
        if (file._exif !== undefined) return file._exif;
        // A read in progress is shared, not answered with "none" meanwhile
        if (file._exifReading) return file._exifReading;
        file._exifReading = (async () => {
            let info = null;
            if (/\.jpe?g$/i.test(file.name)) {
                try {
                    const fileData = await file.handle.getFile();
                    const head = await fileData.slice(0, 256 * 1024).arrayBuffer();
                    info = this.readJpegExifInfo(head);
                } catch (e) { /* none */ }
            }
            file._exif = info;
            file._exifReading = null;
            return info;
        })();
        return file._exifReading;
    },

    // The info panel (I): the photo in single view; in the grid, the folder
    // being shown, or the selection when several photos are selected.
    // target: { file } or { folder: path } to show one in particular (File
    // Info / Folder Info in the right-click menus) until the grid changes.
    toggleInfoPanel(forceOpen = null, target = null) {
        const panel = this.elements.infoPanel;
        if (!panel) return;
        const open = forceOpen !== null ? forceOpen : panel.classList.contains('hidden');
        panel.classList.toggle('hidden', !open);
        if (open && History.isOpen()) History.toggle(false);
        this._infoOpen = open;
        this._infoTarget = open ? target : null;
        if (open) this.refreshInfoPanel();
    },

    refreshInfoPanel() {
        if (!this._infoOpen) return;
        const t = this._infoTarget;
        if (t && t.file && this.files.includes(t.file)) return this.fillInfoPanel(t.file);
        if (t && typeof t.folder === 'string') return this.fillFolderInfo({ folder: t.folder });
        if (this.viewMode === 'single') return this.fillInfoPanel(this.currentFile);
        if (this.selection.size > 1) return this.fillFolderInfo({ files: [...this.selection] });
        return this.fillFolderInfo({ folder: Folders.scope });
    },

    // Selection changes come in bursts (a click clears and adds): one refresh
    refreshInfoSoon() {
        if (!this._infoOpen || this._infoQueued) return;
        this._infoQueued = true;
        requestAnimationFrame(() => {
            this._infoQueued = false;
            this.refreshInfoPanel();
        });
    },

    // Back to following the grid (a click, a new folder) after File Info /
    // Folder Info picked something in particular
    releaseInfoTarget() {
        if (!this._infoTarget) return;
        this._infoTarget = null;
        this.refreshInfoSoon();
    },

    setInfoRows(title, rows) {
        const panel = this.elements.infoPanel;
        panel.querySelector('h3').textContent = title;
        const list = this.elements.infoList;
        list.innerHTML = '';
        rows.forEach(([k, v, cls]) => {
            if (k === '—') {
                const hr = document.createElement('div');
                hr.className = 'info-sep';
                list.appendChild(hr);
                return;
            }
            const dt = document.createElement('dt');
            dt.textContent = k;
            const dd = document.createElement('dd');
            dd.textContent = v == null ? '—' : v;
            if (cls) dd.className = cls;
            list.appendChild(dt);
            list.appendChild(dd);
        });
    },

    // Count, size, types, dates and flags of some photos
    photoStats(files) {
        let bytes = 0, largest = null, oldest = Infinity, newest = -Infinity;
        const types = new Map();
        const flags = { star: 0, rescan: 0, color: 0 };
        for (const f of files) {
            bytes += f.size || 0;
            if (!largest || (f.size || 0) > (largest.size || 0)) largest = f;
            if (f.lastModified) {
                if (f.lastModified < oldest) oldest = f.lastModified;
                if (f.lastModified > newest) newest = f.lastModified;
            }
            let ext = (f.name.match(/\.(\w+)$/) || [, '?'])[1].toUpperCase();
            if (ext === 'JPG') ext = 'JPEG';
            types.set(ext, (types.get(ext) || 0) + 1);
            const fl = f._flags;
            if (fl) {
                if (fl.star) flags.star++;
                if (fl.rescan) flags.rescan++;
                if (fl.color) flags.color++;
            }
        }
        return { n: files.length, bytes, largest, oldest, newest, types, flags };
    },

    statRows(st) {
        const day = (t) => new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        const rows = [];
        rows.push(['Size', this.formatBytes(st.bytes)]);
        if (st.n > 1) rows.push(['Average', this.formatBytes(Math.round(st.bytes / st.n))]);
        if (st.largest && st.n > 1) rows.push(['Largest', `${st.largest.name} (${this.formatBytes(st.largest.size)})`]);
        if (st.types.size) rows.push(['Types', [...st.types].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n.toLocaleString()}`).join(' · ')]);
        if (isFinite(st.oldest)) rows.push(['Modified', day(st.oldest) === day(st.newest) ? day(st.oldest) : `${day(st.oldest)} – ${day(st.newest)}`]);
        const fl = [];
        if (st.flags.star) fl.push(`★ ${st.flags.star}`);
        if (st.flags.rescan) fl.push(`rescan ${st.flags.rescan}`);
        if (st.flags.color) fl.push(`labelled ${st.flags.color}`);
        if (fl.length) rows.push(['Flags', fl.join(' · ')]);
        return rows;
    },

    // folder: a path ('' the opened folder, null All photos); files: a selection
    async fillFolderInfo({ folder = null, files = null }) {
        const list = this.elements.infoList;
        if (!list) return;
        const token = (this._infoToken = (this._infoToken || 0) + 1);
        const plural = (n, w) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`;
        const rows = [];
        let title;
        const whole = folder === null || folder === '' || !this.dirHandle;
        if (files) {
            title = 'Selection';
            rows.push(['Photos', files.length.toLocaleString()]);
            rows.push(...this.statRows(this.photoStats(files)));
        } else {
            title = folder === null ? 'Project' : 'Folder';
            const name = folder === null ? Folders.rootName() : Folders.nameOf(folder);
            rows.push(['Name', name]);
            if (folder) rows.push(['Location', `${Folders.rootName()} / ${Folders.label(folder)}`]);
            const all = folder === null ? this.files : this.files.filter(f => Folders.within(Folders.dirOf(f), folder));
            const here = folder === null ? all : all.filter(f => Folders.dirOf(f) === folder);
            const subs = this.dirHandle ? [...Folders.map.keys()].filter(k => k !== '' && k !== folder && Folders.within(k, folder || '')).length : 0;
            if (here.length !== all.length) {
                rows.push(['Photos', `${here.length.toLocaleString()} here · ${all.length.toLocaleString()} with subfolders`]);
            } else {
                rows.push(['Photos', all.length.toLocaleString()]);
            }
            if (subs) rows.push(['Folders', subs.toLocaleString()]);
            const st = this.photoStats(all);
            rows.push(...this.statRows(st));
            if (here.length !== all.length) rows.splice(rows.findIndex(r => r[0] === 'Size') + 1, 0, ['Size here', this.formatBytes(this.photoStats(here).bytes)]);
            if (!whole) {
                rows.push(['—']);
                rows.push(['Whole project', `${plural(this.files.length, 'photo')} · ${this.formatBytes(this.photoStats(this.files).bytes)}`]);
            }
        }
        // The current filter or search, if any
        if (Flags.active()) rows.push(['Showing', `${this.viewFiles().length.toLocaleString()} matching the ${Flags.filter ? 'filter' : 'search'}`]);
        // What jEditor itself keeps in the folder (worked out in the background)
        const showOwn = !files && whole && this.dirHandle && !this.readOnlyMode;
        const label = FolderCache.native() ? 'Kept on this PC' : '.jeditor';
        if (showOwn) rows.push(['—'], [label, 'Adding up…', 'info-pending']);
        this.setInfoRows(title, rows);
        if (!showOwn) return;
        const own = await this.jeditorUsage();
        if (token !== this._infoToken) return;
        const i = rows.findIndex(r => r[0] === label);
        rows.splice(i, 1);
        if (!own || !own.bytes) {
            rows.splice(i, 0, [label, 'nothing']);
        } else {
            const parts = [[label, this.formatBytes(own.bytes)]];
            if (own.trash.n) parts.push(['  Trash', `${plural(own.trash.n, 'photo')} · ${this.formatBytes(own.trash.bytes)}`]);
            if (own.cache.bytes) parts.push(['  Cache', this.formatBytes(own.cache.bytes)]);
            if (own.originals.n) parts.push(['  Originals', `${plural(own.originals.n, 'photo')} · ${this.formatBytes(own.originals.bytes)}`]);
            rows.splice(i, 0, ...parts);
        }
        this.setInfoRows(title, rows);
    },

    // .jeditor's size, worked out at most every 30 s (it reads every cached
    // thumbnail's size, so not on every click)
    jeditorUsage() {
        const c = this._usage;
        if (c && c.dir === this.dirHandle && Date.now() - c.at < 30000) return c.value; // cleared by jEditor's own writes
        const value = FolderCache.usage(this);
        this._usage = { dir: this.dirHandle, at: Date.now(), value };
        return value;
    },

    async fillInfoPanel(file) {
        const list = this.elements.infoList;
        if (!list || !file) return;
        this.elements.infoPanel.querySelector('h3').textContent = 'File info';
        const token = (this._infoToken = (this._infoToken || 0) + 1);

        const rows = [];
        rows.push(['Name', file.name]);
        rows.push(['Location', this.getDisplayPath(file)]);
        rows.push(['Type', (file.name.match(/\.(\w+)$/) || [, '?'])[1].toUpperCase()]);
        rows.push(['Size', this.formatBytes(file.size)]);
        rows.push(['Modified', file.lastModified ? new Date(file.lastModified).toLocaleString() : '—']);

        const render = () => {
            if (token !== this._infoToken) return; // superseded by newer fill
            list.innerHTML = '';
            rows.forEach(([k, v]) => {
                const dt = document.createElement('dt');
                dt.textContent = k;
                const dd = document.createElement('dd');
                dd.textContent = v == null ? '—' : v;
                list.appendChild(dt);
                list.appendChild(dd);
            });
        };
        render(); // paint the cheap fields immediately

        // Dimensions: reuse the already-decoded single-view image if it's this file
        try {
            let dims = null;
            const img = this.elements.currentImage;
            if (file._dims) {
                dims = `${file._dims.w} × ${file._dims.h}`;
            } else if (this._displayFile === file && this._displayKind === 'full' && img.naturalWidth > 0) {
                dims = `${img.naturalWidth} × ${img.naturalHeight}`;
            } else {
                const bmp = await createImageBitmap(await file.handle.getFile());
                dims = `${bmp.width} × ${bmp.height}`;
                bmp.close();
            }
            rows.splice(3, 0, ['Dimensions', dims]);
        } catch (e) { /* skip dimensions */ }

        const exif = await this.getExifInfo(file);
        if (exif) {
            if (exif.dateTaken) rows.push(['Taken', exif.dateTaken.toLocaleString()]);
            const camera = [exif.make, exif.model].filter(Boolean).join(' ');
            if (camera) rows.push(['Camera', camera]);
        }
        render();
    },

    // Instantly rotate every on-screen preview of a file via CSS
    applyPreviewRotation(file) {
        const angle = this.getDisplayRotation(file, 'thumb');
        const transform = angle ? `rotate(${angle}deg)` : '';
        const gridImg = file._gridEl && file._gridEl.querySelector('img');
        if (gridImg) gridImg.style.transform = transform;
        const stripImg = file._stripEl && file._stripEl.querySelector('img');
        if (stripImg) stripImg.style.transform = transform;
        if (this.currentFile === file) this.updateImageTransform();
    },

    // Output format when a file must be re-encoded (crop, or non-JPEG rotation)
    getSaveFormat(name) {
        if (/\.png$/i.test(name)) return { type: 'image/png', quality: undefined }; // lossless
        if (/\.webp$/i.test(name)) return { type: 'image/webp', quality: 0.95 };
        return { type: 'image/jpeg', quality: 0.95 };
    },

    // ---- Lossless JPEG rotation (EXIF orientation) ----
    //
    // Rotating a JPEG by decoding + re-encoding degrades quality on every
    // click and is slow. Instead we rewrite the EXIF orientation flag: a
    // byte-level patch with no decode at all. Browsers, OSes and photo apps
    // apply the flag when displaying.

    // Composing a 90° clockwise rotation onto each EXIF orientation value.
    // Values 1-8 form the dihedral group D4: 1→6→3→8→1 (pure rotations),
    // 2→7→4→5→2 (mirrored variants).
    ORIENTATION_ROTATE_CW: { 1: 6, 2: 7, 3: 8, 4: 5, 5: 2, 6: 3, 7: 4, 8: 1 },

    composeOrientation(current, deg) {
        let o = (current >= 1 && current <= 8) ? current : 1;
        const steps = (((deg / 90) % 4) + 4) % 4;
        for (let i = 0; i < steps; i++) o = this.ORIENTATION_ROTATE_CW[o];
        return o;
    },

    // Locate the EXIF orientation value in a JPEG buffer.
    // Returns { valueOffset, littleEndian } if the tag exists,
    // { insert: true } if the JPEG has no EXIF segment at all,
    // or null if this isn't a patchable JPEG (caller falls back to re-encode).
    findJpegOrientation(view) {
        if (view.byteLength < 4 || view.getUint16(0) !== 0xFFD8) return null;
        let offset = 2;
        while (offset + 4 <= view.byteLength) {
            const marker = view.getUint16(offset);
            if ((marker & 0xFF00) !== 0xFF00) return null; // corrupt stream
            // Reached image data without seeing an EXIF segment
            if (marker === 0xFFDA || marker === 0xFFD9) return { insert: true };
            const size = view.getUint16(offset + 2); // includes the two length bytes
            if (size < 2) return null;
            if (marker === 0xFFE1 && offset + 10 <= view.byteLength &&
                view.getUint32(offset + 4) === 0x45786966 /* 'Exif' */ &&
                view.getUint16(offset + 8) === 0x0000) {
                const tiff = offset + 10;
                if (tiff + 8 > view.byteLength) return null;
                const bo = view.getUint16(tiff);
                let littleEndian;
                if (bo === 0x4949) littleEndian = true;       // 'II'
                else if (bo === 0x4D4D) littleEndian = false; // 'MM'
                else return null;
                if (view.getUint16(tiff + 2, littleEndian) !== 0x002A) return null;
                const ifd0 = tiff + view.getUint32(tiff + 4, littleEndian);
                if (ifd0 + 2 > view.byteLength) return null;
                const count = view.getUint16(ifd0, littleEndian);
                for (let i = 0; i < count; i++) {
                    const entry = ifd0 + 2 + i * 12;
                    if (entry + 12 > view.byteLength) return null;
                    if (view.getUint16(entry, littleEndian) === 0x0112) {
                        if (view.getUint16(entry + 2, littleEndian) !== 3) return null; // not SHORT
                        return { valueOffset: entry + 8, littleEndian };
                    }
                }
                // EXIF exists but has no orientation tag (typical for
                // scanners): the tag gets added by relocating IFD0.
                return { relocate: { marker: 0xE1, start: offset, end: offset + 2 + size } };
            }
            offset += 2 + size;
        }
        return null;
    },

    // In-place edits that rotate a JPEG which already has an orientation
    // tag: [{ position, data }] for the tag (and any XMP tiff:Orientation in
    // the header), or null when the file needs a full rewrite.
    async orientationPatch(fileData, deg) {
        const head = new Uint8Array(await fileData.slice(0, 256 * 1024).arrayBuffer());
        const view = new DataView(head.buffer);
        const loc = this.findJpegOrientation(view);
        if (!loc || loc.valueOffset === undefined) return null;
        const next = this.composeOrientation(view.getUint16(loc.valueOffset, loc.littleEndian), deg);
        const tag = new Uint8Array(2);
        new DataView(tag.buffer).setUint16(0, next, loc.littleEndian);
        const edits = [{ position: loc.valueOffset, data: tag }];
        for (const seg of ImageMeta.jpegSegments(head, { partial: true }) || []) {
            if (!ImageMeta.isXmpSeg(head, seg)) continue;
            const text = new TextDecoder('latin1').decode(head.subarray(seg.start, seg.end));
            const re = /tiff:Orientation(="|>)([1-8])/g;
            let m;
            while ((m = re.exec(text))) {
                edits.push({ position: seg.start + m.index + m[0].length - 1, data: new Uint8Array([0x30 + next]) });
            }
        }
        return edits;
    },

    // Apply edits to a file without rewriting it from script. Returns false
    // (nothing changed) where positional writes aren't supported.
    async writeInPlace(handle, edits) {
        let w;
        try {
            w = await handle.createWritable({ keepExistingData: true });
            for (const e of edits) await w.write({ type: 'write', position: e.position, data: e.data });
            await w.close();
            return true;
        } catch (err) {
            if (w) { try { await w.abort(); } catch (e) { /* already closed */ } }
            this.log('In-place write unavailable, rewriting: ' + err.message);
            return false;
        }
    },

    // Minimal APP1 segment: "Exif\0\0" + TIFF header + one-entry IFD0 (Orientation)
    buildOrientationExif(orientation) {
        const buf = new ArrayBuffer(36); // 2 marker + 2 length + 6 'Exif\0\0' + 26 TIFF
        const v = new DataView(buf);
        let p = 0;
        v.setUint16(p, 0xFFE1); p += 2;
        v.setUint16(p, 34); p += 2;      // segment length (everything except the marker)
        v.setUint32(p, 0x45786966); p += 4; // 'Exif'
        v.setUint16(p, 0x0000); p += 2;
        v.setUint16(p, 0x4D4D); p += 2;  // big-endian TIFF
        v.setUint16(p, 0x002A); p += 2;
        v.setUint32(p, 8); p += 4;       // IFD0 offset
        v.setUint16(p, 1); p += 2;       // entry count
        v.setUint16(p, 0x0112); p += 2;  // Orientation tag
        v.setUint16(p, 3); p += 2;       // type SHORT
        v.setUint32(p, 1); p += 4;       // value count
        v.setUint16(p, orientation); p += 2;
        v.setUint16(p, 0); p += 2;       // value padding
        v.setUint32(p, 0); p += 4;       // next IFD: none
        return new Uint8Array(buf);
    },

    // Returns a rotated JPEG Blob without re-encoding, or null if the file
    // can't be patched (caller falls back to canvas re-encode).
    rotateJpegLossless(buffer, deg) {
        const view = new DataView(buffer);
        const loc = this.findJpegOrientation(view);
        if (!loc) return null;
        let bytes = new Uint8Array(buffer);
        let orientation;
        if (loc.insert) {
            orientation = this.composeOrientation(1, deg);
            const seg = this.buildOrientationExif(orientation);
            const out = new Uint8Array(bytes.length + seg.length);
            out.set(bytes.subarray(0, 2), 0);
            out.set(seg, 2);
            out.set(bytes.subarray(2), 2 + seg.length);
            bytes = out;
        } else if (loc.relocate) {
            orientation = this.composeOrientation(1, deg);
            bytes = ImageMeta.insertExifOrientation(bytes, loc.relocate, orientation);
            if (!bytes) return null;
        } else {
            const current = view.getUint16(loc.valueOffset, loc.littleEndian);
            orientation = this.composeOrientation(current, deg);
            view.setUint16(loc.valueOffset, orientation, loc.littleEndian);
        }
        // Keep an XMP tiff:Orientation (Lightroom writes one) in agreement
        const segs = ImageMeta.jpegSegments(bytes) || [];
        segs.filter(sg => ImageMeta.isXmpSeg(bytes, sg))
            .forEach(sg => ImageMeta.patchXmpOrientation(bytes, sg, orientation));
        return new Blob([bytes], { type: 'image/jpeg' });
    },

    // Fallback rotation: decode → rotate on canvas → re-encode in the file's
    // own format. createImageBitmap applies any EXIF orientation, so the
    // output is upright pixels with no EXIF (orientation 1 implied).
    async rotateByReencoding(fileData, name, normalizedDeg) {
        const { type, quality } = this.getSaveFormat(name);
        const original = new Uint8Array(await fileData.arrayBuffer());
        // EXIF orientation is applied by default ('from-image'); passing
        // that value explicitly throws on older Chrome/Edge
        const bitmap = await createImageBitmap(fileData, {
            colorSpaceConversion: ImageMeta.canCarryProfile(type, original) ? 'none' : 'default'
        });
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const is90or270 = normalizedDeg === 90 || normalizedDeg === 270;
            canvas.width = is90or270 ? bitmap.height : bitmap.width;
            canvas.height = is90or270 ? bitmap.width : bitmap.height;
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.rotate(normalizedDeg * Math.PI / 180);
            ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
            const blob = await new Promise(r => canvas.toBlob(r, type, quality));
            if (!blob) return null;
            return ImageMeta.transplant(original, blob, type, canvas.width, canvas.height);
        } finally {
            bitmap.close();
        }
    },

    // Natural name order (IMG_2 before IMG_10). One collator, reused:
    // localeCompare with options builds a new one for every comparison,
    // which made sorting 2000 photos ~30× slower.
    NAME_ORDER: new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }),

    sortFiles(render = true, { sync = false } = {}) {
        const mode = this.sortMode;

        this.files.sort((a, b) => {
            let valA, valB;

            if (mode.startsWith('name')) {
                valA = a.name;
                valB = b.name;
            } else if (mode.startsWith('date')) {
                valA = a.lastModified || 0;
                valB = b.lastModified || 0;
            } else if (mode.startsWith('size')) {
                valA = a.size || 0;
                valB = b.size || 0;
            } else if (mode.startsWith('taken')) {
                valA = a.dateTaken ?? a.lastModified ?? 0;
                valB = b.dateTaken ?? b.lastModified ?? 0;
            }

            if (typeof valA === 'string') {
                const cmp = this.NAME_ORDER.compare(valA, valB);
                return mode.endsWith('asc') ? cmp : -cmp;
            } else {
                return mode.endsWith('asc') ? valA - valB : valB - valA;
            }
        });

        // Selection and currentFile hold file objects, so nothing to remap —
        // the same photos stay selected/active regardless of order.
        if (render) {
            this.renderThumbnails();
            this.renderGrid({ sync });
            this.updateActiveThumbnail();
            this.updateSelectionUI();
            if (this.getCurrentIndex() !== -1) this.updateFileCount();
        }
    },

    // Back to the start screen, with everything saved (before ejecting the
    // drive the project is on: nothing of it may stay open)
    async closeFolder() {
        if (!this.dirHandle) return;
        try { await Flags.save(); } catch (e) { /* best-effort */ }
        try { await Edits.flush(); } catch (e) { /* best-effort */ }
        await FolderCache.flush();
        this.cleanupURLs();
        FolderCache.reset();
        this.files = [];
        this.selection = new Set();
        this.currentFile = null;
        this.dirHandle = null;
        this.elements.gridView.innerHTML = '';
        this.elements.thumbnailStrip.innerHTML = '';
        this.elements.mainInterface.classList.add('hidden');
        this.elements.dropZone.classList.remove('hidden');
        Places.apply();
        Windows.publish();
    },

    cleanupURLs() {
        // Drop queued thumbnail work for the folder being replaced
        if (this._thumbQueue) this._thumbQueue.length = 0;
        // Its jobs were just dropped, so "Preparing previews" can't finish: it goes
        this._precacheGen = (this._precacheGen || 0) + 1;
        this.endTask('precache');
        Folders.reset();
        Watch.stop();
        Flags.reset();
        Edits.reset();

        // Revoke all existing object URLs to free memory
        if (this.files) {
            this.files.forEach(file => {
                if (file.thumbnailUrl) {
                    URL.revokeObjectURL(file.thumbnailUrl);
                    delete file.thumbnailUrl;
                }
                if (file.fullImageUrl) {
                    URL.revokeObjectURL(file.fullImageUrl);
                    delete file.fullImageUrl;
                }
                delete file._decodedEl;
                if (file._edited) {
                    URL.revokeObjectURL(file._edited.url);
                    delete file._edited;
                }
                if (file._preview) {
                    URL.revokeObjectURL(file._preview.url);
                    delete file._preview;
                }
            });
        }
        this._decodedFiles = new Set();
        if (this.elements.currentImage.src && this.elements.currentImage.src.startsWith('blob:')) {
            // We don't want to revoke the src if it's currently being used by a file.fullImageUrl 
            // that we want to keep. But since we clear all fullImageUrls above, it is safe.
            URL.revokeObjectURL(this.elements.currentImage.src);
        }
    },

    // The film strip (single view). Items load their thumbnail as they
    // scroll into sight.
    renderThumbnails() {
        this.elements.thumbnailStrip.innerHTML = '';
        const frag = document.createDocumentFragment();
        if (this._stripObserver) this._stripObserver.disconnect();
        this._stripObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                const div = entry.target;
                this.loadStripThumbnail(div._file, div);
                this._stripObserver.unobserve(div);
            });
        }, { root: this.elements.thumbnailStrip, rootMargin: '0px 400px' });

        this.viewFiles().forEach((file) => frag.appendChild(this.makeStripItem(file)));
        this.elements.thumbnailStrip.appendChild(frag);
        this._activeStripEl = null;
        this.updateActiveThumbnail();
    },

    makeStripItem(file) {
        const div = document.createElement('div');
        div.className = 'thumb-item';
        div._file = file;
        file._stripEl = div;
        Flags.decorate(div, file);
        Edits.decorate(div, file);
        div.onclick = () => this.openSingle(file);
        if (this._stripObserver) this._stripObserver.observe(div);
        return div;
    },

    async loadStripThumbnail(file, div, force = false) {
        if (!file) return;
        try {
            // Reuse the internal logic effectively but target the div background or an img inside
            // To keep style simple, let's add an img inside
            const img = document.createElement('img');
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            img.style.pointerEvents = 'none'; // let click pass to div
            img.style.transition = 'transform 0.15s ease'; // snappy rotation previews
            div.appendChild(img);
            if (force || !file.thumbnailUrl) this.showThumbSpinner(div, img);

            await this.loadImageThumbnail(file, img, force);
        } catch (e) { /* ignore */ }
    },

    // Highlight the current photo in the film strip and center it. Touches
    // only the old and new thumbnail: looping over every strip item and
    // scrollIntoView (which re-lays out the page) cost ~100 ms per step in a
    // 2000-photo folder.
    updateActiveThumbnail() {
        const strip = this.elements.thumbnailStrip;
        const el = this.currentFile && this.currentFile._stripEl;
        if (this._activeStripEl && this._activeStripEl !== el) this._activeStripEl.classList.remove('active');
        this._activeStripEl = el && el.isConnected ? el : null;
        if (!this._activeStripEl) return;
        el.classList.add('active');
        if (strip.classList.contains('hidden') || !strip.clientWidth) return;
        const target = el.offsetLeft - (strip.clientWidth - el.offsetWidth) / 2;
        if (Math.abs(strip.scrollLeft - target) > 1) strip.scrollLeft = target;
    },

    // Grid View with Lazy Loading. sync: every tile now, so a re-render
    // after a move keeps the scroll position.
    renderGrid({ sync = false } = {}) {
        this.elements.gridView.innerHTML = '';
        this._shownSelected = new Set();
        this._activeGridEl = null;

        // Tiles load once and keep their thumbnail; leaving the viewport no
        // longer blanks them (re-decoding on re-entry was a scroll-jank source)
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                const img = entry.target;
                const file = img._file;
                if (!file) return;
                observer.unobserve(img);
                this.loadImageThumbnail(file, img); // urgent: jumps the precache queue
            });
        }, { root: null, rootMargin: '1000px' });
        this.elements.gridView._observer = observer; // Stash for refreshThumbnailUI

        this.syncGridTile();
        // Subfolders of the folder being shown come first
        const files = this.viewFiles();
        const folderTiles = Folders.folderTiles();
        this.elements.gridView.append(...folderTiles);
        this.elements.gridView.classList.toggle('grid-empty', !files.length && !folderTiles.length && Folders.scope !== null && this.files.length > 0);
        // A project with no photos at all yet
        this.elements.gridView.classList.toggle('grid-empty-project', !this.files.length && !folderTiles.length);
        this.elements.gridView.classList.toggle('grid-no-match', !files.length && Flags.active());
        Folders.render();

        // Chunked render: big folders paint the first screenfuls immediately
        // and append the rest during idle time. (gridRendering: tiles are
        // still being added, so photos can't be slotted in one by one yet.)
        const CHUNK = sync ? Infinity : 500;
        const token = (this._gridRenderToken = (this._gridRenderToken || 0) + 1);
        this.gridRendering = true;
        const renderChunk = (start) => {
            if (token !== this._gridRenderToken) return; // superseded re-render
            const frag = document.createDocumentFragment();
            const end = Math.min(start + CHUNK, files.length);
            for (let i = start; i < end; i++) {
                frag.appendChild(this.makeGridTile(files[i], observer));
            }
            this.elements.gridView.appendChild(frag);
            if (end >= files.length) this.gridRendering = false;
            if (end < files.length) {
                if (typeof requestIdleCallback === 'function') requestIdleCallback(() => renderChunk(end));
                else setTimeout(() => renderChunk(end), 16);
            }
        };
        renderChunk(0);
    },

    // Transparent stand-in while a tile's thumbnail is on its way
    BLANK_THUMB: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PC9zdmc+',

    // Spinner on a tile until its image has a real picture (or failed).
    // Keyed to the image's own load event, so it stays up through decoding
    // rather than vanishing a beat before the photo appears.
    showThumbSpinner(tile, img) {
        const done = () => {
            if (img.src === this.BLANK_THUMB) return;
            tile.classList.remove('thumb-loading');
            img.removeEventListener('load', done);
            img.removeEventListener('error', done);
        };
        tile.classList.add('thumb-loading');
        img.addEventListener('load', done);
        img.addEventListener('error', done);
        if (img.complete && img.naturalWidth && img.src !== this.BLANK_THUMB) done();
    },

    makeGridTile(file, observer) {
        const div = document.createElement('div');
        div.className = 'grid-item';
        div._file = file;
        file._gridEl = div;
        // Tiles are built in chunks: each one starts in the right state
        if (this.selection.has(file)) {
            div.classList.add('selected');
            (this._shownSelected || (this._shownSelected = new Set())).add(file);
        }
        if (file === this.currentFile) {
            div.classList.add('active');
            this._activeGridEl = div;
        }

        const img = document.createElement('img');
        img._file = file;
        img.alt = file.name;
        img.loading = 'lazy';
        img.decoding = 'async';

        if (file.thumbnailUrl) {
            // Cached: paint immediately, no observer round-trip
            img.src = file.thumbnailUrl;
            const angle = this.getDisplayRotation(file, 'thumb');
            if (angle) img.style.transform = `rotate(${angle}deg)`;
        } else {
            img.src = this.BLANK_THUMB;
            observer.observe(img);
        }

        div.appendChild(img);
        if (!file.thumbnailUrl) this.showThumbSpinner(div, img);
        Folders.addChip(div, file);
        Flags.decorate(div, file);
        Edits.decorate(div, file);
        // Just arrived (auto-check): a brief glow so it's easy to spot
        if (file._arrived && Date.now() - file._arrived < 6000) div.classList.add('is-new');

        // Drag onto a folder to move it there (Ctrl/Alt copies)
        if (this.dirHandle && !this.readOnlyMode) {
            div.draggable = true;
            div.addEventListener('dragstart', (e) => Folders.dragStart(e, file));
        }

        div.onclick = (e) => this.handleGridClick(e, file);
        div.ondblclick = () => this.openSingle(file);
        return div;
    },

    // ---- Thumbnail pipeline ----
    //
    // Thumbnails are generated in a Web Worker (decode + downscale + encode
    // all happen off the main thread) through a small priority queue, so
    // scrolling never competes with image processing. After a folder loads,
    // every thumbnail is pre-generated in the background, and cached
    // thumbnails are kept for the whole session — scrolling anywhere in the
    // grid only ever assigns already-generated object URLs.

    THUMB_WIDTH: 320,
    THUMB_CONCURRENCY: 4,
    THUMB_FAST_PATH_BYTES: 50 * 1024, // files this small serve as their own thumbnail

    // Two workers from one source: 'thumb' (grid thumbnails, lots of small
    // jobs) and 'preview' (screen-sized single-view images), so a folder's
    // thumbnail pre-cache never delays the photo you are looking at.
    getImageWorker(kind = 'thumb') {
        const failedKey = '_' + kind + 'WorkerFailed', workerKey = '_' + kind + 'Worker';
        const jobsKey = kind === 'thumb' ? '_thumbJobs' : '_previewJobs';
        if (this[failedKey]) return null;
        if (this[workerKey]) return this[workerKey];
        try {
            if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
                throw new Error('Worker/OffscreenCanvas unavailable');
            }
            const src = `
            // A JPEG's stored pixel size, from its frame header (null if not a
            // JPEG). Headers are small; a big one (embedded previews, color
            // profiles) is read further, up to 4 MB.
            const jpegSize = async (file) => {
                for (let len = 128 * 1024; ; len *= 4) {
                    const b = new Uint8Array(await file.slice(0, len).arrayBuffer());
                    if (b[0] !== 0xFF || b[1] !== 0xD8) return null;
                    let i = 2;
                    while (i + 9 < b.length) {
                        if (b[i] !== 0xFF) return null;
                        const m = b[i + 1];
                        if (m === 0xFF) { i++; continue; }
                        if (m === 0x01 || (m >= 0xD0 && m <= 0xD8)) { i += 2; continue; }
                        if (m === 0xD9 || m === 0xDA) return null;
                        if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) {
                            return { w: (b[i + 7] << 8) | b[i + 8], h: (b[i + 5] << 8) | b[i + 6] };
                        }
                        i += 2 + ((b[i + 2] << 8) | b[i + 3]);
                    }
                    if (b.length < len || len >= 4 * 1024 * 1024) return null;
                }
            };
            // Big JPEGs decode at a fraction of their size (n/8 — the decoder
            // skips most of the work, 4× faster on scans): the smallest that
            // still satisfies need(w, h). → { bmp, size, swapped } with the
            // orientation applied, or null to decode in full instead.
            // Off for the session where the decoder can't do it (no
            // orientation reported, or it keeps failing): no double decodes
            let scaledOff = typeof ImageDecoder === 'undefined', scaledFails = 0;
            const decodeScaled = async (file, need) => {
                if (scaledOff) return null;
                const size = await jpegSize(file);
                if (!size || !size.w || !size.h) return null;
                let n = 1;
                while (n < 8 && !need(Math.ceil(size.w * n / 8), Math.ceil(size.h * n / 8))) n++;
                if (n === 8) return null;
                const dec = new ImageDecoder({ data: file.stream(), type: 'image/jpeg',
                    desiredWidth: Math.ceil(size.w * n / 8), desiredHeight: Math.ceil(size.h * n / 8) });
                try {
                    const { image } = await dec.decode();
                    try {
                        // Only where the decoder reports the photo's orientation
                        // (and so applies it); and only a size that's enough
                        if (typeof image.rotation !== 'number') { scaledOff = true; return null; }
                        if (!need(image.codedWidth, image.codedHeight)) return null;
                        const bmp = await createImageBitmap(image);
                        scaledFails = 0;
                        return { bmp, size, swapped: image.rotation % 180 !== 0 };
                    } finally {
                        image.close();
                    }
                } catch (err) {
                    if (++scaledFails >= 5) scaledOff = true;
                    return null;
                } finally {
                    dec.close();
                }
            };
            self.onmessage = async (e) => {
                const { id, file, targetWidth, type, edge } = e.data;
                try {
                    if (edge) {
                        // Screen-sized preview: long side \`edge\`
                        const scaled = await decodeScaled(file, (w, h) => Math.max(w, h) >= edge).catch(() => null);
                        const full = scaled ? scaled.bmp : await createImageBitmap(file);
                        const w = scaled ? (scaled.swapped ? scaled.size.h : scaled.size.w) : full.width;
                        const h = scaled ? (scaled.swapped ? scaled.size.w : scaled.size.h) : full.height;
                        if (Math.max(w, h) <= edge * 1.2) {
                            full.close();
                            self.postMessage({ id, result: { small: true, w, h } });
                            return;
                        }
                        const k = edge / Math.max(w, h);
                        const bmp = await createImageBitmap(full, {
                            resizeWidth: Math.max(1, Math.round(w * k)),
                            resizeHeight: Math.max(1, Math.round(h * k)),
                            resizeQuality: 'high'
                        });
                        full.close();
                        const canvas = new OffscreenCanvas(bmp.width, bmp.height);
                        canvas.getContext('2d').drawImage(bmp, 0, 0);
                        bmp.close();
                        const blob = await canvas.convertToBlob({ type, quality: 0.9 });
                        self.postMessage({ id, result: { blob, w, h } });
                        return;
                    }
                    // Thumbnail: \`targetWidth\` wide (either way round)
                    const scaled = await decodeScaled(file, (w, h) => Math.min(w, h) >= targetWidth).catch(() => null);
                    let bitmap;
                    if (scaled) {
                        bitmap = await createImageBitmap(scaled.bmp, { resizeWidth: targetWidth, resizeQuality: 'medium' });
                        scaled.bmp.close();
                    } else {
                        bitmap = await createImageBitmap(file, { resizeWidth: targetWidth, resizeQuality: 'medium' });
                    }
                    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
                    canvas.getContext('2d').drawImage(bitmap, 0, 0);
                    bitmap.close();
                    const blob = await canvas.convertToBlob(type === 'image/png' ? { type } : { type: 'image/jpeg', quality: 0.8 });
                    self.postMessage({ id, blob });
                } catch (err) {
                    self.postMessage({ id, error: String((err && err.message) || err) });
                }
            };`;
            const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
            this[jobsKey] = new Map();
            worker.onmessage = (e) => {
                const jobs = this[jobsKey];
                const job = jobs.get(e.data.id);
                if (!job) return;
                jobs.delete(e.data.id);
                if (e.data.error) job.reject(new Error(e.data.error));
                else job.resolve(e.data.result || e.data.blob);
            };
            worker.onerror = () => {
                this[failedKey] = true;
                const jobs = this[jobsKey];
                this[jobsKey] = new Map();
                jobs.forEach(j => j.reject(new Error(kind + ' worker crashed')));
            };
            this[workerKey] = worker;
        } catch (e) {
            this[failedKey] = true;
            this[workerKey] = null;
        }
        return this[workerKey];
    },

    getThumbWorker() {
        return this.getImageWorker('thumb');
    },

    async generateThumbnailBlob(fileData) {
        // Keep alpha-capable formats as PNG so transparency doesn't go black
        const outType = /png|webp|gif/i.test(fileData.type || '') ? 'image/png' : 'image/jpeg';

        const worker = this.getImageWorker('thumb');
        if (worker) {
            try {
                return await new Promise((resolve, reject) => {
                    const id = (this._thumbSeq = (this._thumbSeq || 0) + 1);
                    this._thumbJobs.set(id, { resolve, reject });
                    worker.postMessage({ id, file: fileData, targetWidth: this.THUMB_WIDTH, type: outType });
                });
            } catch (e) {
                this.log('Thumbnail worker failed, using main thread: ' + e.message);
            }
        }

        // Main-thread fallback
        const bitmap = await createImageBitmap(fileData, { resizeWidth: this.THUMB_WIDTH });
        try {
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            canvas.getContext('2d').drawImage(bitmap, 0, 0);
            return await new Promise(r => canvas.toBlob(r, outType, 0.8));
        } finally {
            bitmap.close();
        }
    },

    // Queue thumbnail generation. Urgent requests (visible tiles) jump the
    // queue ahead of background pre-caching. Returns a promise for the URL.
    ensureThumbnail(fileEntry, { urgent = false, force = false } = {}) {
        if (!force) {
            if (fileEntry.thumbnailUrl) return Promise.resolve(fileEntry.thumbnailUrl);
            if (fileEntry._thumbPromise) {
                if (urgent) this.promoteThumbJob(fileEntry);
                return fileEntry._thumbPromise;
            }
        }

        if (!this._thumbQueue) this._thumbQueue = [];
        const job = { fileEntry };
        fileEntry._thumbPromise = new Promise((resolve, reject) => {
            job.resolve = resolve;
            job.reject = reject;
        });
        fileEntry._thumbPromise.catch(() => { }); // consumers may not await

        if (urgent) this._thumbQueue.unshift(job);
        else this._thumbQueue.push(job);
        this.pumpThumbQueue();
        return fileEntry._thumbPromise;
    },

    promoteThumbJob(fileEntry) {
        const q = this._thumbQueue || [];
        const i = q.findIndex(j => j.fileEntry === fileEntry);
        if (i > 0) q.unshift(q.splice(i, 1)[0]);
    },

    pumpThumbQueue() {
        this._thumbActive = this._thumbActive || 0;
        while (this._thumbActive < this.THUMB_CONCURRENCY && this._thumbQueue && this._thumbQueue.length) {
            const job = this._thumbQueue.shift();
            this._thumbActive++;
            this.runThumbJob(job).finally(() => {
                this._thumbActive--;
                this.pumpThumbQueue();
            });
        }
    },

    async runThumbJob(job) {
        const fileEntry = job.fileEntry;
        for (let attempt = 0; ; attempt++) {
            try {
                await this.makeThumbnail(fileEntry);
                job.resolve(fileEntry.thumbnailUrl);
                return;
            } catch (e) {
                // A save landing mid-read invalidates the file snapshot: retry once
                if (attempt === 0) continue;
                fileEntry._thumbPromise = null;
                console.warn('Thumbnail error (will retry):', e);
                const fallback = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjx0ZXh0IHg9IjEwIiB5PSIyMCIgZm9udC1zaXplPSIyMCI+4pqcPC90ZXh0Pjwvc3ZnPg==';
                (fileEntry._thumbWaiters || []).forEach(img => { img.src = fallback; });
                fileEntry._thumbWaiters = [];
                job.reject(e);
                return;
            }
        }
    },

    async makeThumbnail(fileEntry) {
        // Don't read mid-save; the rotation queue is quick (EXIF patch)
        while (fileEntry.isBusy) await new Promise(r => setTimeout(r, 30));

        // Bytes read now include everything saved so far; any save that
        // lands while we decode shows up in the lag delta below.
        const savedAtRead = fileEntry._savedRotationTotal || 0;
        const editGen = fileEntry._editGen || 0;
        const fileData = await fileEntry.handle.getFile();
        if (!fileData.size) throw new Error('empty file (still being written?)');

        let blob;
        if (fileEntry._edit) {
            // Edited, not saved yet: from the edited preview (not cached)
            blob = await this.editedThumbnail(fileEntry);
        } else if (fileData.size <= this.THUMB_FAST_PATH_BYTES) {
            // A copy, not the File itself — the File stops being readable
            // once the photo is rotated
            blob = new Blob([await fileData.arrayBuffer()], { type: fileData.type });
        } else {
            // Persistent cache: reopening a folder skips regeneration.
            // The key includes size+mtime, so edits invalidate naturally.
            const cacheKey = `${fileEntry.relPath || fileEntry.name}|${fileData.size}|${fileData.lastModified}`;
            // This browser's cache, then the folder's own (.jeditor) — made
            // on any computer that opened the folder — then generate
            blob = await this.idbGetThumb(cacheKey);
            if (!blob) {
                blob = await FolderCache.getThumb(this, cacheKey);
                if (blob) this.idbPutThumb(cacheKey, blob);
                else {
                    blob = await this.generateThumbnailBlob(fileData);
                    if (blob) this.idbPutThumb(cacheKey, blob);
                }
            }
            // Keep the folder's copy in step (skipped when it's there)
            if (blob) FolderCache.putThumb(this, cacheKey, blob);
        }
        if (!blob) throw new Error('Thumbnail encode failed');
        // Its edit changed meanwhile: a newer thumbnail is on the way
        if ((fileEntry._editGen || 0) !== editGen) return;

        if (fileEntry.thumbnailUrl) URL.revokeObjectURL(fileEntry.thumbnailUrl);
        fileEntry.thumbnailUrl = URL.createObjectURL(blob);
        fileEntry.thumbLag = (fileEntry._savedRotationTotal || 0) - savedAtRead;
        fileEntry._thumbPromise = null;
        fileEntry._thumbStale = false;
        this.deliverThumbnail(fileEntry);
    },

    async editedThumbnail(file) {
        const src = await this.getDisplaySource(file);
        const bmp = await createImageBitmap(src.blob, { resizeWidth: this.THUMB_WIDTH, resizeQuality: 'medium' });
        try {
            const canvas = document.createElement('canvas');
            canvas.width = bmp.width;
            canvas.height = bmp.height;
            canvas.getContext('2d').drawImage(bmp, 0, 0);
            const alpha = /\.(png|webp|gif)$/i.test(file.name);
            return await new Promise(r => canvas.toBlob(r, alpha ? 'image/png' : 'image/jpeg', 0.8));
        } finally {
            bmp.close();
        }
    },

    deliverThumbnail(fileEntry) {
        const url = fileEntry.thumbnailUrl;
        (fileEntry._thumbWaiters || []).forEach(img => {
            img.decoding = 'async';
            img.onerror = () => { if (img.src === fileEntry.thumbnailUrl) this.thumbnailBroken(fileEntry); };
            img.src = url;
        });
        fileEntry._thumbWaiters = [];
        // A tile drawn again while this was being made shows the old one
        for (const holder of [fileEntry._gridEl, fileEntry._stripEl]) {
            const img = holder && holder.isConnected && holder.querySelector(':scope > img');
            if (img && img.src !== url && img.src !== this.BLANK_THUMB) img.src = url;
        }
        this.applyPreviewRotation(fileEntry);
    },

    async loadImageThumbnail(fileEntry, imgElement, force = false) {
        if (!fileEntry) return;

        // Track elements that need this thumbnail
        if (!fileEntry._thumbWaiters) fileEntry._thumbWaiters = [];
        if (imgElement && !fileEntry._thumbWaiters.includes(imgElement)) {
            fileEntry._thumbWaiters.push(imgElement);
        }

        if (!force && fileEntry.thumbnailUrl) {
            this.deliverThumbnail(fileEntry);
            return;
        }

        await this.ensureThumbnail(fileEntry, { urgent: true, force }).catch(() => this.retryThumbnail(fileEntry));
    },

    // A thumbnail that couldn't be made, or made but not shown (the file
    // was caught half-written, say): try again a few times, a little later
    // each time, rather than leave the tile blank
    THUMB_RETRIES: 4,

    retryThumbnail(fileEntry) {
        const n = (fileEntry._thumbRetries || 0) + 1;
        if (n > this.THUMB_RETRIES) return;
        fileEntry._thumbRetries = n;
        setTimeout(() => {
            if (!this.files.includes(fileEntry) || fileEntry.thumbnailUrl) return;
            this.refreshThumbnailUI(fileEntry);
        }, 1500 * n);
    },

    thumbnailBroken(fileEntry) {
        if (!fileEntry.thumbnailUrl) return;
        URL.revokeObjectURL(fileEntry.thumbnailUrl);
        fileEntry.thumbnailUrl = null;
        fileEntry._thumbPromise = null;
        this.retryThumbnail(fileEntry);
    },

    // Drop cached thumbnails (in .jeditor) of photos that changed or are gone
    pruneFolderCache() {
        if (!FolderCache.enabled(this)) return;
        const keys = this.files.filter(f => f.size > this.THUMB_FAST_PATH_BYTES)
            .map(f => `${f.relPath || f.name}|${f.size}|${f.lastModified}`);
        FolderCache.flush().then(() => FolderCache.prune(this, keys)).catch(() => { });
    },

    // Remove jEditor's data from the open folder: the trash (deleted photos
    // go for good) and the cache. For when an order is finished.
    async cleanUpFolder() {
        if (!this.dirHandle) return;
        if (!this.ensureWritable()) return;
        const inTrash = await FolderCache.trashCount(this);
        const flagged = Flags.count();
        const edited = Edits.count();
        const items = [
            ...(edited ? [`Discards the edits not saved yet on ${edited} photo${edited === 1 ? '' : 's'} (the photos stay as they are on disk).`] : []),
            ...(inTrash ? [`Empties ${FolderCache.native() ? 'jEditor\'s trash' : 'the trash'}: ${inTrash} deleted photo${inTrash === 1 ? '' : 's'} will be gone for good.`] : []),
            ...(flagged ? [`Removes the flags (stars, rescan flags, color labels) from ${flagged} photo${flagged === 1 ? '' : 's'}.`] : []),
            'Removes cached thumbnails and duplicate data (rebuilt when needed), and the originals kept for undoing Auto crop.'
        ];
        const native = FolderCache.native();
        const ok = await UI.confirm({
            title: native ? 'Clean up this project?' : 'Clean up this folder?',
            message: native ? 'Removes what jEditor keeps on this PC for this project. Do this when a project is finished.'
                : 'Do this when a project is finished, before it goes to the customer.',
            items,
            note: 'Your photos are not touched.',
            ok: 'Clean up',
            danger: true
        });
        if (!ok) return;
        this.beginTask('cleanup', 'Cleaning up folder…');
        try {
            await FolderCache.cleanUp(this);
            Flags.clearAll();
            Edits.clearAll();
            // Trash undo steps can't be undone any more, and flags are gone
            this._undoStack = (this._undoStack || []).filter(e => !['trash', 'flags', 'auto-crop', 'edits', 'saved-edits'].includes(e.type));
            const what = native ? 'Project cleaned up' : 'Folder cleaned up';
            this.showToast(inTrash ? `${what} — trash emptied (${inTrash})` : what, 3000);
        } catch (e) {
            this.showToast('Clean up failed: ' + e.message, 4000);
        } finally {
            this.endTask('cleanup');
        }
    },

    // Pre-generate every thumbnail in the background right after a folder
    // loads, so scrolling the grid only ever hits the cache.
    precacheThumbnails() {
        const missing = this.files.filter(f => !f.thumbnailUrl && !f._thumbPromise);
        if (missing.length === 0) return;

        const total = missing.length;
        const showProgress = total >= 30;
        if (showProgress) this.beginTask('precache', `Preparing previews 0/${total}`);
        const gen = this._precacheGen = (this._precacheGen || 0) + 1;
        let done = 0;
        missing.forEach(file => {
            this.ensureThumbnail(file, { urgent: false })
                .catch(() => { })
                .finally(() => {
                    done++;
                    if (!showProgress || gen !== this._precacheGen) return;
                    if (done === total) {
                        this.endTask('precache');
                        this.showToast(`All ${total} previews ready`, 2000);
                        this.pruneFolderCache();
                    } else if (done % 25 === 0) {
                        this.updateTask('precache', `Preparing previews ${done}/${total}`);
                    }
                });
        });
    },


    handleGridClick(e, file) {
        this.releaseInfoTarget();
        if (e.ctrlKey || e.metaKey) {
            this.toggleSelection(file);
        } else if (e.shiftKey) {
            // Range selection: from the current photo to the clicked one
            const view = this.viewFiles();
            const idx = view.indexOf(file);
            const anchor = this.getCurrentIndex();
            const start = Math.min(anchor === -1 ? idx : anchor, idx);
            const end = Math.max(anchor === -1 ? idx : anchor, idx);
            this.selection.clear();
            for (let i = start; i <= end; i++) this.selection.add(view[i]);
            this.updateSelectionUI();
        } else {
            // Single select. Don't loadFile() here — that decodes the
            // full-resolution image into the hidden single view on every
            // grid click. Double-click / Enter opens the photo.
            this.setCurrent(file);
            this.selection.clear();
            this.selection.add(file);
            this.updateSelectionUI();
        }
    },

    toggleSelection(file) {
        if (this.selection.has(file)) {
            this.selection.delete(file);
        } else {
            this.selection.add(file);
        }
        this.updateSelectionUI();
    },

    clearSelection() {
        this.selection.clear();
        this.updateSelectionUI();
    },

    // Grid highlight: only tiles whose state changed are touched
    updateSelectionUI() {
        const shown = this._shownSelected || new Set();
        for (const f of shown) {
            if (!this.selection.has(f) && f._gridEl) f._gridEl.classList.remove('selected');
        }
        for (const f of this.selection) {
            if (f._gridEl && (!shown.has(f) || !f._gridEl.classList.contains('selected'))) f._gridEl.classList.add('selected');
        }
        this._shownSelected = new Set(this.selection);
        const active = this.currentFile && this.currentFile._gridEl;
        if (this._activeGridEl && this._activeGridEl !== active) this._activeGridEl.classList.remove('active');
        if (active) active.classList.add('active');
        this._activeGridEl = active || null;

        this.refreshInfoSoon();
        if (this.selection.size > 0) {
            this.elements.selectionBar.classList.remove('hidden');
            this.elements.selectionCount.textContent = `${this.selection.size} selected`;
        } else {
            this.elements.selectionBar.classList.add('hidden');
        }
    },

    // Show one photo large (setView loads it)
    openSingle(file) {
        this.currentFile = file;
        this.setView('single');
    },

    toggleView() {
        this.setView(this.viewMode === 'single' ? 'grid' : 'single');
    },

    setView(mode) {
        // Single view needs a photo in the folder being shown
        if (mode === 'single' && !Folders.inView(this.currentFile)) {
            const first = this.viewFiles()[0];
            if (!first) {
                this.showToast('There are no photos in this folder');
                mode = 'grid';
            } else {
                this.currentFile = first;
            }
        }
        this.viewMode = mode;
        this._infoTarget = null;
        document.body.dataset.view = mode; // toasts and the phone layout follow the view
        Folders.render();
        this.updateStatusBar();
        this.refreshInfoSoon();
        const iconGrid = this.elements.btnToggleView.querySelector('.icon-grid');
        const iconSingle = this.elements.btnToggleView.querySelector('.icon-single');

        if (mode === 'grid') {
            document.getElementById('main-view').classList.add('hidden');
            this.elements.imageContainer.classList.add('hidden');
            this.elements.gridView.classList.remove('hidden');
            this.elements.thumbnailStrip.parentElement.querySelector('.controls').classList.add('hidden'); // Hide float controls
            this.elements.thumbnailStrip.classList.add('hidden');
            if (this.elements.stripResize) this.elements.stripResize.classList.add('hidden');
            this.elements.gridControls.classList.remove('hidden');
            this.syncGridTile(); // now, not when the resize observer gets round to it
            iconGrid.classList.add('hidden');
            iconSingle.classList.remove('hidden');

            // Ensure selection UI is correct
            if (this.selection.size === 0 && Folders.inView(this.currentFile)) {
                this.selection.add(this.currentFile);
            }
            this.updateSelectionUI();

            // Scroll to current
            const currentEl = this.currentFile && this.currentFile._gridEl;
            if (currentEl) {
                // setTimeout to allow layout
                setTimeout(() => {
                    currentEl.scrollIntoView({ block: 'center' });
                }, 10);
            }

        } else {
            document.getElementById('main-view').classList.remove('hidden');
            this.elements.imageContainer.classList.remove('hidden');
            this.elements.gridView.classList.add('hidden');
            this.elements.thumbnailStrip.parentElement.querySelector('.controls').classList.remove('hidden');
            this.showControls(false); // shown on the way in, then out of the way
            this.elements.thumbnailStrip.classList.remove('hidden');
            if (this.elements.stripResize) this.elements.stripResize.classList.remove('hidden');
            this.elements.gridControls.classList.add('hidden');
            iconGrid.classList.remove('hidden');
            iconSingle.classList.add('hidden');
            // Single view has no selection. Clear the tiles' highlight too, now
            // while the grid is hidden: left in place, the photos selected
            // last time lit up for a moment when the grid came back.
            this.selection.clear();
            this.updateSelectionUI();

            if (this.currentFile) this.loadFile(this.currentFile);
        }
    },

    loadIndex(index) {
        const view = this.viewFiles();
        if (view.length === 0) return;
        if (index < 0) index = view.length - 1;
        if (index >= view.length) index = 0;
        return this.loadFile(view[index]);
    },

    // Make `file` the current photo: header, counter, status chip, info
    // panel and film strip — everything except the big image.
    setCurrent(file) {
        this.currentFile = file;
        this.elements.fileName.textContent = file.name;
        Flags.updateHeader();
        Edits.updateHeader();
        this.updateFileCount();
        this.updateStatusBar();
        if (this._infoOpen) this.refreshInfoSoon();
        this.updateActiveThumbnail();
    },

    // ---- Single-view display pipeline ----
    //
    // Navigating must never show a blank frame. The photos either side of
    // the current one are decoded ahead of time into detached <img>
    // elements, so stepping to them is a DOM swap with no decode at all. A
    // photo that isn't ready yet shows its cached thumbnail immediately and
    // upgrades to full resolution the moment its decode finishes.

    DECODE_RADIUS: 1, // neighbors kept decoded each side (full-res scans are large)

    // ---- Display sources: screen-sized previews ----
    //
    // A 30-megapixel scan takes ~300 ms to decode and ~120 MB of memory,
    // yet the screen shows ~4 megapixels of it. The single view therefore
    // shows a screen-sized preview (made in a worker, cached per file
    // version in IndexedDB) and loads the original only when you zoom past
    // fit. Edits never use previews: crop and rotation always read the
    // original file and save it in its own format.

    PREVIEW_CACHE_MAX: 400, // previews kept in IndexedDB (oldest evicted)

    previewEdge() {
        const dpr = window.devicePixelRatio || 1;
        return Math.min(4096, Math.max(1600, Math.round(Math.max(screen.width, screen.height) * dpr)));
    },

    // What to show for `file` at screen size, read from its current bytes:
    // { url, blob?, isPreview, savedAtRead, w, h } with w×h the original size.
    // A photo with an edit not saved yet (edits.js) is shown with it, unless
    // raw: the crop editor and Auto crop work on the photo as it is.
    getDisplaySource(file, { raw = false } = {}) {
        if (!raw && file._edit) return this.editedSource(file);
        if (file._sourcePromise) return file._sourcePromise;
        const p = (async () => {
            while (file.isBusy) await new Promise(r => setTimeout(r, 30));
            // Just rotated: carry its cached preview over first (a few ms)
            // instead of making a new one from the full scan
            if (file._cacheFrom) await this.carryCache(file).catch(() => { });
            const savedAtRead = file._savedRotationTotal || 0;
            const data = await file.handle.getFile();
            const edge = this.previewEdge();
            const key = `p|${file.relPath || file.name}|${data.size}|${data.lastModified}|${edge}`;
            if (file._preview && file._preview.key === key) return file._preview;

            // Already about screen size? The header says so: show the
            // original without decoding it in the worker first (that full
            // decode only to learn "it's small" doubled the load time of
            // screen-sized scans)
            const head = new Uint8Array(await data.slice(0, 256 * 1024).arrayBuffer());
            const dims = ImageMeta.readPixelSize(head);
            if (dims && Math.max(dims.w, dims.h) <= edge * 1.2) {
                const src = await this.getOriginalSource(file, data, savedAtRead);
                return { ...src, w: dims.w, h: dims.h };
            }

            let rec = await this.idbGet('previews', key);
            if (!rec) {
                rec = await this.generatePreview(data, edge);
                if (rec && rec.blob) this.idbPutPreview(key, rec);
            }
            if (rec && rec.blob) {
                if (file._preview) URL.revokeObjectURL(file._preview.url);
                file._preview = {
                    key, blob: rec.blob, url: URL.createObjectURL(rec.blob),
                    isPreview: true, savedAtRead, w: rec.w, h: rec.h
                };
                return file._preview;
            }
            // Already screen-sized (or no worker): the original is the source
            return this.getOriginalSource(file, data, savedAtRead);
        })();
        file._sourcePromise = p;
        p.catch(() => { }).finally(() => { if (file._sourcePromise === p) file._sourcePromise = null; });
        return p;
    },

    // The photo with its edit, at screen size: made from the photo's own
    // preview, so it's quick, and it's what Save will write (at full size)
    editedSource(file) {
        const gen = file._editGen || 0;
        if (file._editPromise && file._editPromise._gen === gen) return file._editPromise;
        const p = (async () => {
            const edit = file._edit;
            const raw = await this.getDisplaySource(file, { raw: true });
            const key = `${raw.url}|${gen}`;
            if (file._edited && file._edited.key === key) return file._edited;
            const blob = raw.blob || await (await fetch(raw.url)).blob();
            const bmp = await createImageBitmap(blob);
            // Its size in the photo's own pixels (the preview is smaller)
            const scale = Math.max(raw.w || bmp.width, raw.h || bmp.height) / Math.max(bmp.width, bmp.height);
            let canvas;
            try {
                canvas = CropEditor.fromSnapshot(bmp.width, bmp.height, edit).drawOutput(bmp);
            } finally {
                bmp.close();
            }
            const alpha = /\.(png|webp|gif)$/i.test(file.name);
            const out = await new Promise(r => canvas.toBlob(r, alpha ? 'image/png' : 'image/jpeg', 0.92));
            const w = Math.round(canvas.width * scale), h = Math.round(canvas.height * scale);
            canvas.width = canvas.height = 0;
            if (!out) throw new Error('encoding failed');
            const src = { key, blob: out, url: URL.createObjectURL(out), isPreview: true, edited: true, savedAtRead: raw.savedAtRead, w, h };
            if ((file._editGen || 0) !== gen) return src; // edited again meanwhile: not kept
            if (file._edited) URL.revokeObjectURL(file._edited.url);
            file._edited = src;
            return src;
        })();
        p._gen = gen;
        file._editPromise = p;
        p.catch(() => { }).finally(() => { if (file._editPromise === p) file._editPromise = null; });
        return p;
    },

    // An edit not saved yet was made, changed or dropped: show the photo
    // as it now will be
    editChanged(f) {
        this.dropEdited(f);
        f._dims = undefined;
        f._thumbStale = true;
        f._sourceGen = (f._sourceGen || 0) + 1; // in-flight decodes won't be cached
        f._decodePromise = null;
        this.dropDecoded(f);
        this.refreshThumbnailUI(f);
        if (this.currentFile === f && this.viewMode === 'single' && !this.cropState.active) this.loadFile(f);
        if (this._infoOpen && this.currentFile === f) this.fillInfoPanel(f);
    },

    // Forget the edited preview (and any being made)
    dropEdited(f) {
        f._editGen = (f._editGen || 0) + 1;
        if (f._edited) {
            URL.revokeObjectURL(f._edited.url);
            delete f._edited;
        }
        f._editPromise = null;
    },

    // A File from getFile() is a snapshot: once the file on disk is written
    // (a rotation, a crop) reading it fails — and so does any blob URL made
    // from it, which showed up as a broken image with the file name. So the
    // displayed original is an in-memory copy of the bytes, remade whenever
    // the file has changed. (Only screen-sized photos and zoomed-in photos
    // are shown from the original; big scans use generated previews.)
    async getOriginalSource(file, data = null, savedAtRead = null) {
        if (!data) {
            while (file.isBusy) await new Promise(r => setTimeout(r, 30));
            savedAtRead = file._savedRotationTotal || 0;
            data = await file.handle.getFile();
        }
        const version = `${data.size}|${data.lastModified}`;
        if (!file.fullImageUrl || file._fullVersion !== version) {
            const copy = new Blob([await data.arrayBuffer()], { type: data.type });
            if (file.fullImageUrl) URL.revokeObjectURL(file.fullImageUrl);
            file.fullImageUrl = URL.createObjectURL(copy);
            file._fullVersion = version;
            file._fullReadAt = savedAtRead;
        }
        return { url: file.fullImageUrl, isPreview: false, savedAtRead: file._fullReadAt };
    },

    // Worker: decode, downscale to `edge`, encode. { blob, w, h },
    // { small: true, w, h } when the image is already about screen size,
    // or null when no worker is available.
    generatePreview(fileData, edge) {
        const worker = this.getImageWorker('preview');
        if (!worker) return Promise.resolve(null);
        const alpha = /png|webp|gif/i.test(fileData.type || '');
        return new Promise((resolve) => {
            const id = (this._thumbSeq = (this._thumbSeq || 0) + 1);
            this._previewJobs.set(id, { resolve: (d) => resolve(d), reject: () => resolve(null) });
            worker.postMessage({ id, file: fileData, edge, type: alpha ? 'image/webp' : 'image/jpeg' });
        });
    },

    // Decode a file's display source into a detached element (deduped).
    decodeFull(file) {
        const cached = file._decodedEl;
        if (cached) return Promise.resolve(cached);
        if (file._decodePromise) return file._decodePromise;
        const p = (async () => {
            const attempt = async () => {
                try {
                    return await this.decodeInto(file, await this.getDisplaySource(file));
                } catch (e) {
                    return null; // the file changed or vanished mid-read
                }
            };
            let el = await attempt();
            if (!el || !el._decoded) {
                // Usually a save landed while this was loading: read the
                // file again rather than keep a broken image
                this.forgetSources(file);
                el = await attempt();
            }
            if (!el || !el._decoded) return el || { _decoded: false }; // unreadable — not cached
            // Cache unless the file was edited (and invalidated) meanwhile
            if (file._sourceGen === p._gen) {
                file._decodedEl = el;
                if (!this._decodedFiles) this._decodedFiles = new Set();
                this._decodedFiles.add(file);
            }
            return el;
        })();
        p._gen = file._sourceGen;
        file._decodePromise = p;
        p.catch(() => { }).finally(() => {
            if (file._decodePromise === p) file._decodePromise = null;
        });
        return p;
    },

    async decodeInto(file, src) {
        const el = new Image();
        el.decoding = 'async';
        el.draggable = false;
        el.alt = file.name;
        el.src = src.url;
        el._url = src.url;
        el._savedAtRead = src.savedAtRead;
        el._isPreview = !!src.isPreview;
        try {
            await el.decode();
            el._decoded = true;
        } catch (e) {
            el._decoded = false; // undecodable file: still shown (as broken)
        }
        el._origW = src.w || el.naturalWidth;
        el._origH = src.h || el.naturalHeight;
        return el;
    },

    // Zoomed past fit on a preview: swap in the original for full detail
    async ensureFullRes() {
        const el = this.elements.currentImage;
        const file = this._displayFile;
        if (!el || !el._isPreview || !file || file !== this.currentFile || this._upgrading === file) return;
        if (file._edit) return; // shown edited: the original would show it without
        this._upgrading = file;
        try {
            const src = await this.getOriginalSource(file);
            const full = await this.decodeInto(file, src);
            if (this.elements.currentImage !== el || !full._decoded) return;
            this.swapDisplay(full, 'full', file);
            this.dropDecoded(file);
            file._decodedEl = full;
            this._decodedFiles.add(file);
        } catch (e) {
            /* stay on the preview */
        } finally {
            this._upgrading = null;
        }
    },

    // Prepare previews a few photos ahead in the direction of travel, one at
    // a time, so paging through an order never waits on a decode.
    warmPreviews(file) {
        const view = this.viewFiles();
        const n = view.length;
        const i = view.indexOf(file);
        if (i === -1 || n < 3) return;
        const dir = this._navDir || 1;
        for (let d = 2; d <= 4; d++) {
            const f = view[(i + d * dir + n * 4) % n];
            if (!f || f._preview || f._warming) continue;
            f._warming = true;
            this._warmChain = (this._warmChain || Promise.resolve())
                .then(() => this.getDisplaySource(f).catch(() => { }))
                .finally(() => { f._warming = false; });
        }
    },

    // Drop every cached display source of a file so the next load re-reads it
    forgetSources(file) {
        if (file.fullImageUrl) {
            URL.revokeObjectURL(file.fullImageUrl);
            delete file.fullImageUrl;
        }
        if (file._preview) {
            URL.revokeObjectURL(file._preview.url);
            delete file._preview;
        }
        file._sourcePromise = null;
    },

    dropDecoded(file) {
        delete file._decodedEl;
        if (this._decodedFiles) this._decodedFiles.delete(file);
    },

    // Put an element on screen as the single-view image. kind is 'full' or
    // 'thumb' (a placeholder, which carries the thumbnail's rotation lag).
    swapDisplay(el, kind, file) {
        const cur = this.elements.currentImage;
        if (el !== cur) {
            cur.removeAttribute('id');
            el.id = 'current-image';
            cur.replaceWith(el);
            this.elements.currentImage = el;
        }
        this._displayKind = kind;
        this._displayFile = file;
        if (kind === 'thumb') this.sizePlaceholder(el, file);
        el.style.transition = 'none'; // no spin/float from the previous photo's transform
        el.style.opacity = '1';
        this.updateImageTransform();
        requestAnimationFrame(() => { el.style.transition = ''; });
    },

    // A thumbnail is only 320px wide; size it like the full image will be
    sizePlaceholder(el, file) {
        const box = this.elements.imageContainer;
        const cw = box.clientWidth, ch = box.clientHeight;
        const nw = el.naturalWidth, nh = el.naturalHeight;
        if (!cw || !ch || !nw || !nh) return;
        const aspect = nw / nh;
        let w = cw, h = cw / aspect;
        if (h > ch) { h = ch; w = ch * aspect; }
        if (file && file._dims && file._dims.w < w) { w = file._dims.w; h = w / aspect; }
        el.style.width = w + 'px';
        el.style.height = h + 'px';
    },

    async loadFile(file) {
        if (!file) return;

        // Token guards against out-of-order async loads during rapid navigation
        const loadToken = (this._loadToken = (this._loadToken || 0) + 1);
        this.setCurrent(file);

        // Reset zoom/pan (rotation display is per-file via getDisplayRotation)
        this.zoom = 1;
        this.panX = 0;
        this.panY = 0;
        this.elements.imageContainer.style.cursor = 'default';

        const ready = file._decodedEl;
        const loadStart = performance.now();
        if (ready && ready._decoded) {
            // Preloaded neighbour: on screen this frame
            this.swapDisplay(ready, 'full', file);
            this.afterDisplay(file, ready);
            this.recordLoadTime(0);
        } else {
            // Show the cached thumbnail straight away (unless it is being
            // regenerated after an edit and would show the old pixels)...
            if (file.thumbnailUrl && !file._thumbStale) {
                const ph = new Image();
                ph.draggable = false;
                ph.alt = file.name;
                ph.src = file.thumbnailUrl;
                ph._savedAtRead = (file._savedRotationTotal || 0) - (file.thumbLag || 0);
                const showPlaceholder = () => {
                    if (this._loadToken !== loadToken) return;
                    if (this._displayFile === file && this._displayKind === 'full') return;
                    this.swapDisplay(ph, 'thumb', file);
                };
                if (ph.complete && ph.naturalWidth) showPlaceholder();
                else ph.decode().then(showPlaceholder, () => { });
            } else {
                // Nothing cached yet: dim the previous photo while decoding
                this.elements.currentImage.style.opacity = '0.3';
            }

            // ...then upgrade to full resolution when the decode lands
            try {
                const el = await this.decodeFull(file);
                if (this._loadToken !== loadToken) return;
                if (!el._decoded) {
                    // Keep the thumbnail (or previous photo) up instead of a
                    // broken-image icon
                    this.elements.currentImage.style.opacity = '1';
                    this.showToast(`Couldn't load ${file.name} — the file may be damaged or in use`, 4000);
                    return;
                }
                this.swapDisplay(el, 'full', file);
                this.afterDisplay(file, el);
                this.recordLoadTime(performance.now() - loadStart);
            } catch (err) {
                console.error('Error loading image:', err);
                this.elements.currentImage.style.opacity = '1';
            }
        }

        if (this._loadToken !== loadToken) return;
        this.preloadNeighbours(file);
        this.cleanupObjectURLs();
    },

    recordLoadTime(ms) {
        if (!this._loadTimes) this._loadTimes = [];
        this._loadTimes.push(ms);
        if (this._loadTimes.length > 20) this._loadTimes.shift();
    },

    afterDisplay(file, el) {
        if (el._decoded && el._origW) file._dims = { w: el._origW, h: el._origH };
        this.warmPreviews(file);
    },

    // Decode the photos either side (wrapping, like navigation does) and
    // release decoded images that fell out of that window.
    preloadNeighbours(file) {
        const view = this.viewFiles();
        const n = view.length;
        const i = view.indexOf(file);
        if (i === -1 || n < 2) return;
        const keep = new Set([file]);
        for (let d = 1; d <= this.DECODE_RADIUS; d++) {
            keep.add(view[(i + d) % n]);
            keep.add(view[(i - d + n) % n]);
        }
        keep.forEach(f => {
            if (f !== file && !f.isBusy && !f.pendingRotation) this.decodeFull(f).catch(() => { });
        });
        (this._decodedFiles || new Set()).forEach(f => {
            if (!keep.has(f) && this.elements.currentImage !== f._decodedEl) this.dropDecoded(f);
        });
    },

    cleanupObjectURLs() {
        // Thumbnails are small (≈10–30 KB each) and are kept for the whole
        // session. Only full-size images are trimmed.
        const view = this.viewFiles();
        const cur = view.indexOf(this.currentFile);
        const pos = view === this.files ? null : new Map(view.map((f, i) => [f, i]));
        const windowSizeFull = 4; // in-memory copies of originals (see getOriginalSource)


        this.files.forEach((f, i) => {
            if (f === this.currentFile) return;
            const at = pos ? pos.get(f) : i;
            const dist = at === undefined ? Infinity : Math.abs(at - cur);
            if (dist > windowSizeFull && f.fullImageUrl && !f._decodePromise) {
                URL.revokeObjectURL(f.fullImageUrl);
                delete f.fullImageUrl;
                if (f._decodedEl && !f._decodedEl._isPreview) this.dropDecoded(f);
            }
            // Previews are small, but not free; far ones come back from IndexedDB
            if (dist > 60 && f._preview && !f._sourcePromise) {
                URL.revokeObjectURL(f._preview.url);
                delete f._preview;
            }
            // Edited previews too (made again from the preview when needed)
            if (dist > 60 && f._edited && !f._editPromise) {
                URL.revokeObjectURL(f._edited.url);
                delete f._edited;
            }
        });
    },

    navigate(direction) {
        const view = this.viewFiles();
        if (view.length === 0) return;
        this._navDir = direction < 0 ? -1 : 1;
        const n = view.length;
        const at = this.getCurrentIndex();
        if (at === -1) return this.goTo(view[0]);
        let newIndex = at + direction;
        if (Math.abs(direction) > 1) {
            // Row jumps in the grid stop at the edges instead of wrapping
            newIndex = Math.max(0, Math.min(n - 1, newIndex));
        } else {
            newIndex = (newIndex + n) % n;
        }
        this.goTo(view[newIndex]);
    },

    goTo(file) {
        if (!file) return;
        if (this.viewMode !== 'grid') {
            this.loadFile(file);
            return;
        }
        // Grid: select and scroll — no full-resolution decode for a
        // photo that isn't being shown large
        this.setCurrent(file);
        this.selection.clear();
        this.selection.add(file);
        this.updateSelectionUI();
        const item = file._gridEl;
        if (item) {
            const rect = item.getBoundingClientRect();
            const containerRect = this.elements.gridView.getBoundingClientRect();
            if (rect.top < containerRect.top || rect.bottom > containerRect.bottom) {
                item.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
        }
    },

    // Stacking toasts: each message gets its own glass pill; concurrent
    // operations stack instead of overwriting each other. Passing the same
    // `key` updates an existing toast in place (progress → done), and
    // duration 0 keeps a toast up (with a spinner) until it is updated with
    // a duration. The same message again while it's showing bumps a ×2
    // counter instead of stacking a copy. A toast with a button stays up
    // while hovered, and clicking it dismisses it; the others let clicks
    // through to the photos underneath.
    // action: { label, run } adds a button to the toast
    // opts.type: 'success' | 'error' | 'warn' | 'info' | 'progress' (guessed
    // from the message when left out)
    TOAST_MAX: 5,
    TOAST_ICONS: {
        success: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
        error: '<path d="M8 8l8 8"/><path d="M16 8l-8 8"/>',
        warn: '<path d="M12 8v5"/><path d="M12 16.6v.01"/>',
        info: '<path d="M12 11v5.5"/><path d="M12 7.6v.01"/>',
        trash: '<path d="M5 7h14"/><path d="M10 7V5h4v2"/><path d="M7 7l1 12h8l1-12"/>',
        undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
        folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
        rotate: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>',
        photos: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 16l5-5 4 4 3-3 6 6"/>',
        flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
        star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/>',
        search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
        crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>'
    },

    toastType(message, duration) {
        if (duration === 0) return 'progress';
        if (/fail|couldn.t|could not|can.t|error|not supported|blocked|invalid|damaged|already exists|requires|need(s)? a folder/i.test(message)) return 'error';
        if (/^(nothing to|there are no|no changes|that was the last|these photos were opened read-only)/i.test(message)) return 'info';
        if (/^(undid|.*undone|restored|put \d+ photos? back|removed \d+ cop)/i.test(message)) return 'undo';
        if (/^(moved|copied) [\d,]+ photos? to /i.test(message)) return 'folder';
        if (/trash/i.test(message)) return 'trash';
        if (/^rotated/i.test(message)) return 'rotate';
        if (/^(straightened|cropped|auto-cropped)/i.test(message)) return 'crop';
        if (/new photo|^loaded|^found/i.test(message)) return 'photos';
        if (/^(saved|moved|copied|made|renamed|deleted|all .* ready|folder (is up to date|cleaned)|updated|exported|shortcuts reset|slideshow)/i.test(message)) return 'success';
        return 'info';
    },

    showToast(message, duration = 3000, key = null, action = null, opts = {}) {
        // Going back several steps (history.js) says so once, at the end
        if (this._quietToasts) return;
        let stack = document.getElementById('toast-stack');
        if (!stack) {
            stack = document.createElement('div');
            stack.id = 'toast-stack';
            stack.setAttribute('role', 'status');
            stack.setAttribute('aria-live', 'polite');
            document.body.appendChild(stack);
        }
        const live = [...stack.children].filter(t => !t.classList.contains('leaving'));
        let toast = key ? live.find(t => t.dataset.key === key) : null;
        // The same message again: count it rather than stack a copy
        if (!toast && !key && !action) {
            toast = live.find(t => !t.dataset.key && !t.classList.contains('has-action') && t._message === message);
            if (toast) {
                toast._repeat = (toast._repeat || 1) + 1;
                toast.classList.remove('bump');
                void toast.offsetWidth; // restart the bump animation
                toast.classList.add('bump');
            }
        }
        const isNew = !toast;
        if (isNew) {
            toast = document.createElement('div');
            toast.className = 'toast';
            if (key) toast.dataset.key = key;
            toast.addEventListener('mouseenter', () => this.pauseToast(toast));
            toast.addEventListener('mouseleave', () => this.resumeToast(toast));
            toast.addEventListener('click', (e) => {
                if (!e.target.closest('.toast-action')) this.dismissToast(toast);
            });
            stack.appendChild(toast);
            // Keep the stack short: the oldest finished toasts make way
            const extra = live.length + 1 - this.TOAST_MAX;
            if (extra > 0) live.filter(t => t._duration > 0).slice(0, extra).forEach(t => this.dismissToast(t));
        } else if (message !== toast._message || key) {
            toast._repeat = message === toast._message ? toast._repeat : 1;
        }
        const type = opts.type || this.toastType(message, duration);
        toast._message = message;
        toast._duration = duration;
        toast.className = `toast t-${type}` + (isNew ? '' : ' visible') +
            (toast.classList.contains('bump') ? ' bump' : '');

        // Icon · message · ×n · action
        toast.textContent = '';
        const icon = document.createElement('span');
        icon.className = 'toast-icon';
        icon.innerHTML = type === 'progress'
            ? '<span class="toast-spinner"></span>'
            : `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${this.TOAST_ICONS[opts.icon] || this.TOAST_ICONS[type] || this.TOAST_ICONS.info}</svg>`;
        const msg = document.createElement('span');
        msg.className = 'toast-msg';
        msg.textContent = message;
        toast.append(icon, msg);
        if (toast._repeat > 1) {
            const n = document.createElement('span');
            n.className = 'toast-count';
            n.textContent = `×${toast._repeat}`;
            toast.appendChild(n);
        }
        if (action) {
            const btn = document.createElement('button');
            btn.className = 'toast-action';
            btn.textContent = action.label;
            btn.addEventListener('click', () => {
                this.dismissToast(toast);
                action.run();
            });
            toast.appendChild(btn);
            toast.classList.add('has-action');
        }

        if (isNew) requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('visible')));
        if (toast._timer) clearTimeout(toast._timer);
        toast._timer = null;
        toast._remaining = duration;
        if (duration > 0 && !toast._paused) this.resumeToast(toast, true);
        return toast;
    },

    pauseToast(toast) {
        toast._paused = true;
        if (!toast._timer) return;
        clearTimeout(toast._timer);
        toast._timer = null;
        toast._remaining = Math.max(400, toast._remaining - (performance.now() - toast._started));
    },

    resumeToast(toast, fresh = false) {
        if (!fresh) {
            toast._paused = false;
        }
        if (!(toast._duration > 0) || toast._timer) return;
        toast._started = performance.now();
        toast._timer = setTimeout(() => this.dismissToast(toast), toast._remaining);
    },

    // Slide out, then let the toasts below close the gap smoothly
    dismissToast(toast) {
        if (!toast || toast.classList.contains('leaving')) return;
        clearTimeout(toast._timer);
        toast.classList.add('leaving');
        toast.classList.remove('visible');
        toast.style.marginBottom = `-${toast.offsetHeight + 8}px`;
        setTimeout(() => toast.remove(), 300);
    },

    // ---- Keyboard shortcuts ----
    //
    // Every shortcut is a named action with default keys. Any of them can be
    // rebound in the Keyboard Shortcuts panel (?); changes persist in
    // localStorage under 'jeditor.keys'. Keys match exactly, modifiers
    // included, so Ctrl+C never triggers C. The crop editor has its own set.

    KEY_ACTIONS: [
        // [id, context, group, label, default keys]
        ['nav.prev', 'global', 'Navigate', 'Previous photo', ['ArrowLeft']],
        ['nav.next', 'global', 'Navigate', 'Next photo', ['ArrowRight']],
        ['nav.up', 'global', 'Navigate', 'Row up (grid)', ['ArrowUp']],
        ['nav.down', 'global', 'Navigate', 'Row down (grid)', ['ArrowDown']],
        ['nav.first', 'global', 'Navigate', 'First photo', ['Home']],
        ['nav.last', 'global', 'Navigate', 'Last photo', ['End']],
        ['edit.rotateLeft', 'global', 'Edit', 'Rotate left (whole selection in grid)', ['[', ',', 'Shift+ArrowLeft']],
        ['edit.rotateRight', 'global', 'Edit', 'Rotate right (whole selection in grid)', [']', '.', 'Shift+ArrowRight']],
        ['edit.rotate180', 'global', 'Edit', 'Rotate 180° (whole selection in grid)', ['\\']],
        ['edit.crop', 'global', 'Edit', 'Crop & straighten', ['C']],
        ['edit.rename', 'global', 'Edit', 'Rename (the selection in grid view)', ['F2']],
        ['edit.trash', 'global', 'Edit', 'Move to trash', ['Delete']],
        ['edit.undo', 'global', 'Edit', 'Undo', ['Ctrl+Z']],
        ['edit.history', 'global', 'Edit', 'Undo history: go back several steps', ['H']],
        ['edit.selectAll', 'global', 'Edit', 'Select all (grid)', ['Ctrl+A']],
        ['flag.star', 'global', 'Flags', 'Star / unstar', ['P']],
        ['flag.rescan', 'global', 'Flags', 'Needs rescan on / off', ['X']],
        ['flag.red', 'global', 'Flags', 'Red label', ['1']],
        ['flag.yellow', 'global', 'Flags', 'Yellow label', ['2']],
        ['flag.green', 'global', 'Flags', 'Green label', ['3']],
        ['flag.blue', 'global', 'Flags', 'Blue label', ['4']],
        ['flag.purple', 'global', 'Flags', 'Purple label', ['5']],
        ['flag.clear', 'global', 'Flags', 'Clear flags', ['U']],
        ['edit.autoCrop', 'global', 'Edit', 'Auto crop the selection (grid)', ['Shift+A']],
        ['edit.moveTo', 'global', 'Folders', 'Move to a folder…', ['M']],
        ['edit.copyTo', 'global', 'Folders', 'Copy to a folder…', ['Shift+M']],
        ['folders.new', 'global', 'Folders', 'New folder', ['Shift+N']],
        ['folders.up', 'global', 'Folders', 'Up one folder (grid)', ['Backspace', 'Alt+ArrowUp']],
        ['folders.all', 'global', 'Folders', 'Switch between All photos and folders (grid)', ['A']],
        ['folders.rail', 'global', 'Folders', 'Show / hide the folder list (grid)', ['Ctrl+B']],
        ['view.toggle', 'global', 'View', 'Toggle grid / single view', ['Space']],
        ['view.grid', 'global', 'View', 'Grid view', ['G']],
        ['view.single', 'global', 'View', 'Single view', ['S']],
        ['view.open', 'global', 'View', 'Open photo (grid)', ['Enter']],
        ['view.back', 'global', 'View', 'Back to grid / clear selection', ['Escape']],
        ['view.zoomIn', 'global', 'View', 'Zoom in', ['+', '=']],
        ['view.zoomOut', 'global', 'View', 'Zoom out', ['-']],
        ['view.zoomFit', 'global', 'View', 'Zoom to fit', ['0']],
        ['view.info', 'global', 'View', 'Info: the photo, or the folder or selection in the grid', ['I']],
        ['view.fullscreen', 'global', 'View', 'Full screen', ['F']],
        ['view.slideshow', 'global', 'View', 'Slideshow', []],
        ['app.dupes', 'global', 'App', 'Find duplicates (WIP)', ['D']],
        ['app.refresh', 'global', 'App', 'Rescan folder', ['R']],
        ['app.search', 'global', 'App', 'Search photos', ['Ctrl+F', '/']],
        ['app.shortcuts', 'global', 'App', 'Keyboard shortcuts', ['?']],
        ['app.settings', 'global', 'App', 'Settings', ['Ctrl+,']],
        ['app.debug', 'global', 'App', 'Debug console', ['Ctrl+Shift+D']],
        ['crop.save', 'crop', 'Crop & Straighten', 'Save', ['Enter']],
        ['crop.saveNext', 'crop', 'Crop & Straighten', 'Save, then crop next photo', ['Shift+Enter']],
        ['crop.cancel', 'crop', 'Crop & Straighten', 'Cancel', ['Escape']],
        ['crop.rotateLeft', 'crop', 'Crop & Straighten', 'Rotate left 90°', ['[']],
        ['crop.rotateRight', 'crop', 'Crop & Straighten', 'Rotate right 90°', [']']],
        ['crop.rotate180', 'crop', 'Crop & Straighten', 'Rotate 180°', ['\\']],
        ['crop.angleDown', 'crop', 'Crop & Straighten', 'Straighten −0.1°', [',']],
        ['crop.angleUp', 'crop', 'Crop & Straighten', 'Straighten +0.1°', ['.']],
        ['crop.angleDownBig', 'crop', 'Crop & Straighten', 'Straighten −1°', ['<']],
        ['crop.angleUpBig', 'crop', 'Crop & Straighten', 'Straighten +1°', ['>']],
        ['crop.angleZero', 'crop', 'Crop & Straighten', 'Straighten back to 0°', ['0']],
        ['crop.level', 'crop', 'Crop & Straighten', 'Level tool', ['L']],
        ['crop.auto', 'crop', 'Crop & Straighten', 'Auto: straighten and crop to the print', ['Shift+A']],
        ['crop.undo', 'crop', 'Crop & Straighten', 'Undo last adjustment', ['Ctrl+Z']],
        ['crop.redo', 'crop', 'Crop & Straighten', 'Redo', ['Ctrl+Shift+Z', 'Ctrl+Y']],
        ['crop.aspect', 'crop', 'Crop & Straighten', 'Next aspect ratio', ['A']],
        ['crop.swap', 'crop', 'Crop & Straighten', 'Swap portrait / landscape', ['X']],
        ['crop.previous', 'crop', 'Crop & Straighten', 'Reuse previous crop', ['P']],
        ['crop.selectAll', 'crop', 'Crop & Straighten', 'Select whole image', ['Ctrl+A']],
        ['crop.reset', 'crop', 'Crop & Straighten', 'Reset', ['R']],
        ['dupes.next', 'dupes', 'Duplicates (WIP)', 'Next group', ['ArrowRight']],
        ['dupes.prev', 'dupes', 'Duplicates (WIP)', 'Previous group', ['ArrowLeft']],
        ['dupes.keepBest', 'dupes', 'Duplicates (WIP)', 'Keep suggested, mark the rest', ['K']],
        ['dupes.apply', 'dupes', 'Duplicates (WIP)', 'Trash marked & next group', ['Enter']],
        ['dupes.skip', 'dupes', 'Duplicates (WIP)', 'Not duplicates (skip group)', ['N']],
        ['dupes.close', 'dupes', 'Duplicates (WIP)', 'Close', ['Escape']]
    ],

    // Shortcut profiles: a starting set of keys, which can then be changed.
    // jEditor's own is KEY_ACTIONS' defaults; another lists only the keys it
    // changes. Profiles made by the user start from one of these (base) and
    // keep their own changes. Changes are kept per profile in localStorage:
    // 'jeditor.keys' for jEditor's (as before profiles), 'jeditor.keys.<id>'
    // for the others; 'jeditor.keyProfile' is the one in use.
    KEY_PROFILES: {
        jeditor: { name: 'jEditor' },
        // Lightroom Classic's Library and Crop keys, where jEditor has the
        // same action. Its 1–5 are star ratings, so the color labels are on
        // 6–9 as there (purple has no key in Lightroom).
        lightroom: {
            name: 'Lightroom Classic',
            keys: {
                'edit.rotateLeft': ['Ctrl+['],
                'edit.rotateRight': ['Ctrl+]'],
                'edit.rotate180': [],
                'edit.crop': ['R'],
                'flag.red': ['6'],
                'flag.yellow': ['7'],
                'flag.green': ['8'],
                'flag.blue': ['9'],
                'flag.purple': [],
                'view.single': ['E'],
                'view.toggle': [],
                'view.zoomIn': ['Ctrl+=', 'Ctrl++'],
                'view.zoomOut': ['Ctrl+-'],
                'view.zoomFit': ['Z'],
                'view.slideshow': ['Ctrl+Enter'],
                'folders.rail': ['F7'],
                'app.refresh': ['F5'],
                'app.shortcuts': ['Ctrl+/', '?'],
                'crop.save': ['Enter', 'R'],
                'crop.reset': ['Ctrl+Alt+R'],
                'crop.rotateLeft': ['Ctrl+['],
                'crop.rotateRight': ['Ctrl+]']
            }
        }
    },

    // Handlers return false when the key doesn't apply right now, which
    // lets the browser's default behavior through.
    keyHandlers() {
        const grid = () => this.viewMode === 'grid';
        const ed = CropEditor;
        return {
            'nav.prev': () => this.navigate(-1),
            'nav.next': () => this.navigate(1),
            'nav.up': () => grid() ? this.navigate(-this.getGridColumnCount()) : false,
            'nav.down': () => grid() ? this.navigate(this.getGridColumnCount()) : false,
            'nav.first': () => this.goTo(this.viewFiles()[0]),
            'nav.last': () => { const v = this.viewFiles(); this.goTo(v[v.length - 1]); },
            'edit.rotateLeft': () => grid() ? this.rotateBulk(-90) : this.rotateCurrent(-90),
            'edit.rotateRight': () => grid() ? this.rotateBulk(90) : this.rotateCurrent(90),
            'edit.rotate180': () => grid() ? this.rotateBulk(180) : this.rotateCurrent(180),
            'edit.crop': () => this.enterCrop(),
            'edit.rename': () => this.openRename(grid() && this.selection.size ? [...this.selection] : [this.currentFile]),
            'edit.trash': () => this.moveToTrash(grid() && this.selection.size
                ? [...this.selection] : [this.currentFile]),
            'edit.undo': () => this.undo(),
            'edit.history': () => History.toggle(),
            'edit.selectAll': () => {
                if (!grid()) return false;
                this.selection = new Set(this.viewFiles());
                this.updateSelectionUI();
            },
            'flag.star': () => Flags.apply('star'),
            'flag.rescan': () => Flags.apply('rescan'),
            'flag.red': () => Flags.apply('red'),
            'flag.yellow': () => Flags.apply('yellow'),
            'flag.green': () => Flags.apply('green'),
            'flag.blue': () => Flags.apply('blue'),
            'flag.purple': () => Flags.apply('purple'),
            'flag.clear': () => Flags.apply('clear'),
            'edit.autoCrop': () => this.batchAutoCrop(Folders.targets()),
            'edit.moveTo': () => Folders.openPicker(Folders.targets(), 'move'),
            'edit.copyTo': () => Folders.openPicker(Folders.targets(), 'copy'),
            'folders.new': () => this.dirHandle ? Folders.newFolder() : false,
            'folders.up': () => {
                if (!grid() || !this.dirHandle || !Folders.scope) return false;
                Folders.setScope(Folders.parentOf(Folders.scope));
            },
            'folders.all': () => {
                if (!grid() || !this.dirHandle) return false;
                Folders.setScope(Folders.scope === null ? (Folders.map.has(Folders.lastScope) ? Folders.lastScope : '') : null);
            },
            'folders.rail': () => {
                if (!grid() || !this.dirHandle) return false;
                Folders.toggleRail();
            },
            'view.toggle': () => this.toggleView(),
            'view.grid': () => this.setView('grid'),
            'view.single': () => this.setView('single'),
            'view.open': () => grid() ? this.setView('single') : false,
            'view.back': () => grid() ? this.clearSelection() : this.setView('grid'),
            'view.zoomIn': () => this.zoomBy(1.25),
            'view.zoomOut': () => this.zoomBy(0.8),
            'view.zoomFit': () => this.zoomBy(0),
            'view.info': () => this.toggleInfoPanel(),
            'view.fullscreen': () => this.toggleFullscreen(),
            'view.slideshow': () => this.startSlideshow(),
            'app.dupes': () => this.openDupes(),
            'app.refresh': () => this.refreshFolder(),
            'app.search': () => Flags.focusSearch(),
            'app.shortcuts': () => this.toggleShortcutsPanel(),
            'app.settings': () => this.toggleCustomizePanel(true),
            'app.debug': () => this.toggleDebugConsole(),
            'crop.save': () => this.saveCrop(),
            'crop.saveNext': () => this.saveCrop({ next: true }),
            'crop.cancel': () => this.cancelCrop(),
            'crop.rotateLeft': () => ed.rotateQuarter(-1),
            'crop.rotateRight': () => ed.rotateQuarter(1),
            'crop.rotate180': () => ed.rotateHalf(),
            'crop.angleDown': () => ed.nudgeAngle(-0.1),
            'crop.angleUp': () => ed.nudgeAngle(0.1),
            'crop.angleDownBig': () => ed.nudgeAngle(-1),
            'crop.angleUpBig': () => ed.nudgeAngle(1),
            'crop.angleZero': () => ed.setAngle(0, { flash: true }),
            'crop.level': () => ed.toggleLevel(),
            'crop.auto': () => ed.autoDetect(),
            'crop.undo': () => { if (!ed.undo()) this.showToast('Nothing to undo', 1200); },
            'crop.redo': () => { if (!ed.redo()) this.showToast('Nothing to redo', 1200); },
            'crop.aspect': () => ed.cycleAspect(),
            'crop.swap': () => ed.swapOrientation(),
            'crop.previous': () => ed.usePrevious(),
            'crop.selectAll': () => ed.selectAll(),
            'crop.reset': () => ed.reset(),
            'dupes.next': () => Dupes.step(1),
            'dupes.prev': () => Dupes.step(-1),
            'dupes.keepBest': () => Dupes.keepBest(),
            'dupes.apply': () => Dupes.apply(),
            'dupes.skip': () => Dupes.skip(),
            'dupes.close': () => Dupes.close()
        };
    },

    // Normalized combo for a keydown: 'Ctrl+Shift+D', 'Shift+ArrowLeft', 'C',
    // '?' … Cmd counts as Ctrl. Shift is implied by printable symbols ('?'
    // already is Shift+/), so it's only named for letters and named keys.
    comboFromEvent(e) {
        let k = e.key;
        if (!k || ['Control', 'Shift', 'Alt', 'Meta', 'CapsLock', 'Dead', 'Unidentified'].includes(k)) return null;
        const legacy = { ' ': 'Space', Spacebar: 'Space', Esc: 'Escape', Del: 'Delete', Left: 'ArrowLeft', Right: 'ArrowRight', Up: 'ArrowUp', Down: 'ArrowDown' };
        k = legacy[k] || k;
        if (k.length === 1) k = k.toUpperCase();
        const mods = [];
        if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
        if (e.altKey) mods.push('Alt');
        if (e.shiftKey && (k.length > 1 || /^[A-Z]$/.test(k))) mods.push('Shift');
        return [...mods, k].join('+');
    },

    formatCombo(combo) {
        const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '');
        const names = {
            ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
            Escape: 'Esc', Delete: 'Del', Ctrl: isMac ? '⌘' : 'Ctrl'
        };
        const m = combo.match(/^((?:(?:Ctrl|Alt|Shift)\+)*)(.+)$/);
        const parts = m ? [...m[1].split('+').filter(Boolean), m[2]] : [combo];
        return parts.map(p => names[p] || p).join(' + ');
    },

    // The user's own profiles: [{ id, name, base }]
    customKeyProfiles() {
        try {
            const list = JSON.parse(localStorage.getItem('jeditor.keyProfiles') || '[]');
            return Array.isArray(list) ? list.filter(p => p && typeof p.id === 'string' && typeof p.name === 'string') : [];
        } catch (e) { return []; }
    },

    keyProfiles() {
        return [
            ...Object.entries(this.KEY_PROFILES).map(([id, p]) => ({ id, name: p.name, builtIn: true })),
            ...this.customKeyProfiles()
        ];
    },

    // The keys a profile starts with (what Reset goes back to)
    keyProfileDefaults(id = this.keyProfile) {
        const custom = this.customKeyProfiles().find(p => p.id === id);
        const base = this.KEY_PROFILES[custom ? custom.base : id] || this.KEY_PROFILES.jeditor;
        const out = {};
        this.KEY_ACTIONS.forEach(([aid, , , , keys]) => { out[aid] = [...((base.keys && base.keys[aid]) || keys)]; });
        return out;
    },

    keyStore(id = this.keyProfile) {
        return id === 'jeditor' ? 'jeditor.keys' : 'jeditor.keys.' + id;
    },

    loadKeyBindings() {
        let active = 'jeditor';
        try { active = localStorage.getItem('jeditor.keyProfile') || 'jeditor'; } catch (e) { /* private mode */ }
        if (!this.keyProfiles().some(p => p.id === active)) active = 'jeditor';
        this.keyProfile = active;
        this.keyBindings = this.keyProfileDefaults();
        try {
            const saved = JSON.parse(localStorage.getItem(this.keyStore()) || 'null');
            if (saved && typeof saved === 'object') {
                for (const [id, keys] of Object.entries(saved)) {
                    if (id in this.keyBindings && Array.isArray(keys)) {
                        this.keyBindings[id] = keys.filter(k => typeof k === 'string' && k);
                    }
                }
            }
        } catch (e) { /* corrupted → defaults */ }
        this.buildKeyMaps();
    },

    saveKeyBindings() {
        const changed = {};
        const defaults = this.keyProfileDefaults();
        this.KEY_ACTIONS.forEach(([id]) => {
            if (this.keyBindings[id].join('\n') !== defaults[id].join('\n')) changed[id] = this.keyBindings[id];
        });
        try { localStorage.setItem(this.keyStore(), JSON.stringify(changed)); } catch (e) { /* private mode */ }
        this.buildKeyMaps();
    },

    setKeyProfile(id) {
        if (!this.keyProfiles().some(p => p.id === id)) return;
        try { localStorage.setItem('jeditor.keyProfile', id); } catch (e) { /* private mode */ }
        this._recordingKey = null;
        this.loadKeyBindings();
        if (this.isShortcutsOpen()) this.renderShortcutsPanel();
    },

    // A new profile: the keys in use now, under a name, to change from there
    async newKeyProfile() {
        const all = this.keyProfiles();
        const current = all.find(p => p.id === this.keyProfile);
        const name = await UI.prompt({
            title: 'New shortcut profile',
            message: `It starts as a copy of “${current ? current.name : 'jEditor'}”. Change any key after.`,
            ok: 'Make',
            input: { label: 'Name', value: '' }
        });
        if (name === null || !name.trim()) return;
        if (all.some(p => p.name.toLowerCase() === name.trim().toLowerCase())) {
            this.showToast(`There's already a profile called “${name.trim()}”`, 3000);
            return;
        }
        const custom = this.customKeyProfiles().find(p => p.id === this.keyProfile);
        const base = custom ? custom.base : this.keyProfile;
        const id = 'custom-' + Date.now().toString(36);
        const list = [...this.customKeyProfiles(), { id, name: name.trim(), base }];
        try { localStorage.setItem('jeditor.keyProfiles', JSON.stringify(list)); } catch (e) { return; }
        const keys = this.keyBindings;
        this.keyProfile = id;
        this.keyBindings = keys;
        this.saveKeyBindings(); // the copy's changes from its base
        this.setKeyProfile(id);
        this.showToast(`Made “${name.trim()}”`, 2000);
    },

    async renameKeyProfile() {
        const list = this.customKeyProfiles();
        const p = list.find(x => x.id === this.keyProfile);
        if (!p) return;
        const others = this.keyProfiles().filter(x => x.id !== p.id);
        const name = await UI.prompt({
            title: 'Rename profile',
            ok: 'Rename',
            input: { label: 'Name', value: p.name }
        });
        if (name === null || !name.trim()) return;
        if (others.some(x => x.name.toLowerCase() === name.trim().toLowerCase())) {
            this.showToast(`There's already a profile called “${name.trim()}”`, 3000);
            return;
        }
        p.name = name.trim();
        try { localStorage.setItem('jeditor.keyProfiles', JSON.stringify(list)); } catch (e) { /* private mode */ }
        this.renderShortcutsPanel();
    },

    async deleteKeyProfile() {
        const p = this.customKeyProfiles().find(x => x.id === this.keyProfile);
        if (!p) return;
        const ok = await UI.confirm({ title: `Delete “${p.name}”?`, message: 'Its keys go. jEditor\'s own keys are used instead.', ok: 'Delete', danger: true });
        if (!ok) return;
        try {
            localStorage.setItem('jeditor.keyProfiles', JSON.stringify(this.customKeyProfiles().filter(x => x.id !== p.id)));
            localStorage.removeItem(this.keyStore(p.id));
        } catch (e) { /* private mode */ }
        this.setKeyProfile('jeditor');
    },

    buildKeyMaps() {
        this._keyMaps = { global: new Map(), crop: new Map(), dupes: new Map() };
        this.KEY_ACTIONS.forEach(([id, ctx]) => {
            (this.keyBindings[id] || []).forEach(combo => {
                if (!this._keyMaps[ctx].has(combo)) this._keyMaps[ctx].set(combo, id);
            });
        });
    },

    // Give `combo` to action `id`, taking it away from any other action in
    // the same context. Returns the label of the action it was taken from.
    assignKey(id, combo) {
        const action = this.KEY_ACTIONS.find(a => a[0] === id);
        if (!action) return null;
        let takenFrom = null;
        this.KEY_ACTIONS.forEach(([other, ctx, , label]) => {
            if (other === id || ctx !== action[1]) return;
            const keys = this.keyBindings[other];
            if (keys.includes(combo)) {
                this.keyBindings[other] = keys.filter(k => k !== combo);
                takenFrom = label;
            }
        });
        if (!this.keyBindings[id].includes(combo)) this.keyBindings[id].push(combo);
        this.saveKeyBindings();
        return takenFrom;
    },

    removeKey(id, combo) {
        this.keyBindings[id] = (this.keyBindings[id] || []).filter(k => k !== combo);
        this.saveKeyBindings();
    },

    resetKeys(id = null) {
        const defaults = this.keyProfileDefaults();
        this.KEY_ACTIONS.forEach(([aid]) => {
            if (!id || aid === id) this.keyBindings[aid] = [...defaults[aid]];
        });
        this.saveKeyBindings();
    },

    bindKeyboard() {
        this.loadKeyBindings();
        if (this.boundHandleKey) window.removeEventListener('keydown', this.boundHandleKey);
        this.boundHandleKey = this.handleKey.bind(this);
        window.addEventListener('keydown', this.boundHandleKey);
        // The shortcut recorder listens first, in the capture phase
        window.addEventListener('keydown', (e) => this.recordKey(e), true);
    },

    isTypingTarget(t) {
        if (!t || !t.tagName) return false;
        if (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
        return t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(t.type);
    },

    handleKey(e) {
        if (this._recordingKey) return;

        // The rename tool, folder dialogs, Settings and the alert/confirm
        // dialogs handle their own keys
        if (Renamer.isOpen || Folders.isModalOpen() || Recents.isPromptOpen() || UI.isOpen() || Stored.isOpen() || Scan.isOpen() || Camera.isOpen()) return;

        // What's New is modal: Esc closes it
        if (this.isWhatsNewOpen()) {
            if (e.key === 'Escape') {
                e.preventDefault();
                this.toggleWhatsNew(false);
            }
            return;
        }

        // Shortcuts panel is modal: Esc closes it, other keys go to its inputs
        if (this.isShortcutsOpen()) {
            if (e.key === 'Escape') {
                e.preventDefault();
                this.toggleShortcutsPanel(false);
            }
            return;
        }
        if (this.isTypingTarget(e.target)) {
            if (e.key === 'Escape') e.target.blur();
            return;
        }

        const combo = this.comboFromEvent(e);
        if (!combo) return;
        this.stopSlideshow();

        // Escape closes an open context menu before anything else
        if (combo === 'Escape' && document.getElementById('context-menu')) {
            e.preventDefault();
            this.closeContextMenu();
            return;
        }
        if (combo === 'Escape' && History.isOpen()) {
            e.preventDefault();
            History.toggle(false);
            return;
        }

        const context = this.cropState.active ? 'crop' : (Dupes.isOpen ? 'dupes' : 'global');
        // Duplicates view: 1–9 mark/unmark the photo with that number
        if (context === 'dupes' && /^[1-9]$/.test(combo)) {
            e.preventDefault();
            Dupes.toggle(parseInt(combo, 10) - 1);
            return;
        }
        let id = this._keyMaps[context].get(combo);
        // Duplicates: Undo (it says Ctrl+Z restores) works there too
        if (!id && context === 'dupes' && this._keyMaps.global.get(combo) === 'edit.undo') id = 'edit.undo';
        // A focused button's own Enter/Space press isn't a shortcut there
        if (id && context === 'dupes' && e.target && e.target.tagName === 'BUTTON' && (combo === 'Enter' || combo === 'Space')) return;
        if (!id) return;
        // Only the shortcut list and debug console work from the start screen
        const onStart = this.elements.mainInterface.classList.contains('hidden');
        if (onStart && context === 'global' && !['app.shortcuts', 'app.debug', 'app.settings'].includes(id)) return;
        if (context === 'crop' && !CropEditor.ready && id !== 'crop.cancel') {
            e.preventDefault();
            return;
        }

        const handler = this.keyHandlers()[id];
        if (!handler) return;
        if (handler(e) === false) return;
        e.preventDefault();
        e.stopImmediatePropagation();
    },

    openDupes() {
        if (!this.dirHandle) {
            this.showToast('Open a folder to look for duplicates');
            return;
        }
        this.stopSlideshow();
        Dupes.init(this);
        Dupes.open();
    },

    toggleDebugConsole() {
        const debugEl = document.getElementById('debug-console');
        if (!debugEl) return;
        const show = debugEl.classList.toggle('open');
        this.log(show ? 'Console Show' : 'Console Hide');
        clearInterval(this._perfTimer);
        if (show) {
            this.updatePerfReadout();
            this._perfTimer = setInterval(() => this.updatePerfReadout(), 2000);
        }
    },

    // What the app is holding and doing right now — for "it got slow" reports
    perfSnapshot() {
        const files = this.files || [];
        const mb = (n) => (n / 1e6).toFixed(0) + ' MB';
        const previews = files.filter(f => f._preview);
        const times = this._loadTimes || [];
        const cur = this.currentFile;
        const out = [];
        if (performance.memory) {
            out.push(`JS heap ${mb(performance.memory.usedJSHeapSize)} of ${mb(performance.memory.jsHeapSizeLimit)}`);
        }
        out.push(`Undo: ${(this._undoStack || []).length} steps, ${mb(this.undoBytes())} of file copies`);
        out.push(`Images decoded: ${(this._decodedFiles || new Set()).size} · originals open: ${files.filter(f => f.fullImageUrl).length} · previews in memory: ${previews.length} (${mb(previews.reduce((n, f) => n + ((f._preview.blob && f._preview.blob.size) || 0), 0))})`);
        out.push(`Thumbnails: ${files.filter(f => f.thumbnailUrl).length}/${files.length} · queued ${(this._thumbQueue || []).length}`);
        out.push(`Background: ${[...(this._tasks || new Map()).values()].join('; ') || 'idle'}`);
        if (times.length) {
            const avg = times.reduce((a, b) => a + b, 0) / times.length;
            out.push(`Photo load (last ${times.length}): avg ${avg.toFixed(0)} ms, worst ${Math.max(...times).toFixed(0)} ms`);
        }
        if (cur && cur._dims) out.push(`Current photo: ${cur._dims.w} × ${cur._dims.h} (${(cur._dims.w * cur._dims.h / 1e6).toFixed(1)} MP), ${this.formatBytes(cur.size)}`);
        return out;
    },

    updatePerfReadout() {
        const el = document.getElementById('debug-perf');
        const consoleEl = document.getElementById('debug-console');
        if (!el || !consoleEl || !consoleEl.classList.contains('open')) {
            clearInterval(this._perfTimer);
            return;
        }
        el.textContent = this.perfSnapshot().join('\n');
    },

    zoomBy(factor) {
        if (this.viewMode !== 'single' || this.cropState.active) return false;
        this.zoomTo(factor === 0 ? 1 : this.zoom * factor);
    },

    // ---- What's New (changelog.js) ----

    // -1, 0 or 1, comparing dotted version numbers
    compareVersions(a, b) {
        const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const d = (pa[i] || 0) - (pb[i] || 0);
            if (d) return d > 0 ? 1 : -1;
        }
        return 0;
    },

    // A notice linking to what changed, on the first launch of each new
    // version only. Not on the very first visit (there's nothing "new"
    // yet). The newest version announced is remembered, so going back to
    // an older cached copy and forward again doesn't repeat it.
    checkForUpdateNotice() {
        if (typeof APP_VERSION === 'undefined' || typeof CHANGELOG === 'undefined') return;
        let seen = null;
        try {
            seen = localStorage.getItem('jeditor.seenVersion');
            if (!seen || this.compareVersions(APP_VERSION, seen) > 0) localStorage.setItem('jeditor.seenVersion', APP_VERSION);
        } catch (e) { return; /* private mode: no way to show it only once */ }
        if (!seen || this.compareVersions(APP_VERSION, seen) <= 0) return;
        this._newSince = seen;
        setTimeout(() => this.showToast(`Updated to ${APP_VERSION}`, 10000, 'whatsnew',
            { label: 'What\'s new', run: () => this.toggleWhatsNew(true) }), 600);
    },

    isWhatsNewOpen() {
        const p = document.getElementById('whatsnew-panel');
        return !!p && !p.classList.contains('hidden');
    },

    toggleWhatsNew(force = null) {
        const panel = document.getElementById('whatsnew-panel');
        if (!panel) return;
        const open = force !== null ? force : panel.classList.contains('hidden');
        panel.classList.toggle('hidden', !open);
        this.elements.headerControls.classList.remove('expanded');
        if (open) {
            this.renderWhatsNew();
            document.getElementById('whatsnew-list').scrollTop = 0;
        }
    },

    renderWhatsNew() {
        const list = document.getElementById('whatsnew-list');
        list.innerHTML = '';
        const entries = typeof CHANGELOG !== 'undefined' ? CHANGELOG : [];
        const current = typeof APP_VERSION !== 'undefined' ? APP_VERSION : null;
        for (const entry of entries) {
            const sec = document.createElement('section');
            const h = document.createElement('h4');
            const v = document.createElement('span');
            v.className = 'wn-version';
            v.textContent = entry.version;
            h.appendChild(v);
            const d = document.createElement('span');
            d.className = 'wn-date';
            const when = new Date(entry.date + 'T12:00:00');
            d.textContent = isNaN(when) ? entry.date : when.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
            h.appendChild(d);
            const tag = (text, cls) => {
                const t = document.createElement('span');
                t.className = 'wn-tag ' + cls;
                t.textContent = text;
                h.appendChild(t);
            };
            if (entry.version === current) tag('This version', 'current');
            else if (this._newSince && this.compareVersions(entry.version, this._newSince) > 0) tag('New', 'new');
            sec.appendChild(h);
            const ul = document.createElement('ul');
            for (const item of entry.items) {
                const li = document.createElement('li');
                // `key` → a key cap; everything else stays plain text
                String(item).split('`').forEach((part, i) => {
                    if (!part) return;
                    if (i % 2) {
                        const k = document.createElement('kbd');
                        k.textContent = part;
                        li.appendChild(k);
                    } else {
                        li.appendChild(document.createTextNode(part));
                    }
                });
                ul.appendChild(li);
            }
            sec.appendChild(ul);
            list.appendChild(sec);
        }
    },

    // ---- Keyboard Shortcuts panel ----

    isShortcutsOpen() {
        const p = document.getElementById('shortcuts-panel');
        return !!p && !p.classList.contains('hidden');
    },

    toggleShortcutsPanel(force = null) {
        const panel = document.getElementById('shortcuts-panel');
        if (!panel) return;
        const open = force !== null ? force : panel.classList.contains('hidden');
        this._recordingKey = null;
        panel.classList.toggle('hidden', !open);
        if (open) {
            this.renderShortcutsPanel();
            document.getElementById('shortcuts-filter').value = '';
        }
    },

    renderShortcutsPanel() {
        const list = document.getElementById('shortcuts-list');
        const filter = (document.getElementById('shortcuts-filter').value || '').trim().toLowerCase();
        list.innerHTML = '';
        this.renderKeyProfiles();
        const profileDefaults = this.keyProfileDefaults();
        const groups = new Map();
        this.KEY_ACTIONS.forEach(a => {
            const [id, , group, label] = a;
            const keys = this.keyBindings[id];
            const text = (label + ' ' + keys.map(k => this.formatCombo(k)).join(' ')).toLowerCase();
            if (filter && !text.includes(filter)) return;
            if (!groups.has(group)) groups.set(group, []);
            groups.get(group).push(a);
        });

        groups.forEach((actions, group) => {
            const section = document.createElement('section');
            const h = document.createElement('h4');
            h.textContent = group;
            section.appendChild(h);
            actions.forEach(([id, , , label]) => {
                const defaults = profileDefaults[id];
                const row = document.createElement('div');
                row.className = 'sc-row';
                const name = document.createElement('span');
                name.className = 'sc-label';
                name.textContent = label;
                const keysEl = document.createElement('span');
                keysEl.className = 'sc-keys';

                this.keyBindings[id].forEach(combo => {
                    const kbd = document.createElement('button');
                    kbd.className = 'sc-key';
                    kbd.title = 'Remove this key';
                    kbd.textContent = this.formatCombo(combo);
                    kbd.onclick = () => { this.removeKey(id, combo); this.renderShortcutsPanel(); };
                    keysEl.appendChild(kbd);
                });

                const add = document.createElement('button');
                add.className = 'sc-add';
                if (this._recordingKey === id) {
                    add.textContent = 'Press a key… (Esc cancels)';
                    add.classList.add('recording');
                } else {
                    add.textContent = '+';
                    add.title = 'Add a key';
                }
                add.onclick = () => {
                    this._recordingKey = this._recordingKey === id ? null : id;
                    this.renderShortcutsPanel();
                };
                keysEl.appendChild(add);

                if (this.keyBindings[id].join('\n') !== defaults.join('\n')) {
                    const reset = document.createElement('button');
                    reset.className = 'sc-reset';
                    reset.title = 'Back to default: ' + (defaults.map(k => this.formatCombo(k)).join(', ') || 'none');
                    reset.textContent = '↺';
                    reset.onclick = () => { this.resetKeys(id); this.renderShortcutsPanel(); };
                    keysEl.appendChild(reset);
                }
                row.appendChild(name);
                row.appendChild(keysEl);
                section.appendChild(row);
            });
            list.appendChild(section);
        });
        if (!groups.size) list.textContent = 'No shortcuts match.';
    },

    // The profile picker: every profile, the one in use chosen; rename and
    // delete only for the user's own
    renderKeyProfiles() {
        const sel = document.getElementById('shortcuts-profile');
        if (!sel) return;
        sel.innerHTML = '';
        for (const p of this.keyProfiles()) {
            const o = document.createElement('option');
            o.value = p.id;
            o.textContent = p.name;
            sel.appendChild(o);
        }
        sel.value = this.keyProfile;
        const own = !this.KEY_PROFILES[this.keyProfile];
        document.getElementById('shortcuts-profile-rename').classList.toggle('hidden', !own);
        document.getElementById('shortcuts-profile-delete').classList.toggle('hidden', !own);
    },

    // Capture-phase listener: while recording, the next key press becomes
    // the new binding instead of doing anything else.
    recordKey(e) {
        const id = this._recordingKey;
        if (!id) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.key === 'Escape') {
            this._recordingKey = null;
            this.renderShortcutsPanel();
            return;
        }
        const combo = this.comboFromEvent(e);
        if (!combo) return; // a lone modifier: keep waiting for the real key
        this._recordingKey = null;
        const takenFrom = this.assignKey(id, combo);
        if (takenFrom) this.showToast(`${this.formatCombo(combo)} was moved from "${takenFrom}"`, 3000);
        this.renderShortcutsPanel();
    },

    initShortcutsPanel() {
        const panel = document.getElementById('shortcuts-panel');
        if (!panel) return;
        document.getElementById('shortcuts-close').addEventListener('click', () => this.toggleShortcutsPanel(false));
        document.getElementById('shortcuts-reset').addEventListener('click', () => {
            this.resetKeys();
            this.renderShortcutsPanel();
            this.showToast('Shortcuts reset to defaults', 2000);
        });
        document.getElementById('shortcuts-filter').addEventListener('input', () => this.renderShortcutsPanel());
        document.getElementById('shortcuts-profile').addEventListener('change', (e) => {
            this.setKeyProfile(e.target.value);
            const p = this.keyProfiles().find(x => x.id === e.target.value);
            if (p) this.showToast(`Shortcuts: ${p.name}`, 1600);
        });
        document.getElementById('shortcuts-profile-new').addEventListener('click', () => this.newKeyProfile());
        document.getElementById('shortcuts-profile-rename').addEventListener('click', () => this.renameKeyProfile());
        document.getElementById('shortcuts-profile-delete').addEventListener('click', () => this.deleteKeyProfile());
        // Click on the backdrop closes
        panel.addEventListener('mousedown', (e) => { if (e.target === panel) this.toggleShortcutsPanel(false); });
    },

    // Resize the grid's tiles and keep your place: the highlighted photo
    // stays where it is on screen (or, if it's out of sight, the photo in
    // the middle of the view)
    setGridSize(px) {
        const grid = this.elements.gridView;
        const anchor = this.gridAnchor();
        document.documentElement.style.setProperty('--grid-item-size', `${px}px`);
        this.syncGridTile();
        if (anchor) grid.scrollTop += anchor.el.getBoundingClientRect().top - anchor.top;
    },

    // Run fn (which rebuilds the grid) and scroll so the photo that anchored
    // the view is back where it was on screen
    keepGridPlace(fn) {
        const a = this.gridAnchor();
        const result = fn();
        if (a) {
            const grid = this.elements.gridView;
            const el = a.el._file ? a.el._file._gridEl
                : grid.querySelector(`.folder-tile[data-folder-path="${CSS.escape(a.el.dataset.folderPath || '')}"]`);
            if (el && el.isConnected) grid.scrollTop += el.getBoundingClientRect().top - a.top;
        }
        return result;
    },

    gridAnchor() {
        const grid = this.elements.gridView;
        if (grid.classList.contains('hidden')) return null;
        const view = grid.getBoundingClientRect();
        const onScreen = (el) => {
            if (!el || !el.isConnected) return false;
            const r = el.getBoundingClientRect();
            return r.bottom > view.top && r.top < view.bottom;
        };
        let el = this.currentFile && this.currentFile._gridEl;
        if (!onScreen(el)) {
            el = null;
            // The tile nearest the middle of the view
            const midY = (view.top + view.bottom) / 2;
            let best = Infinity;
            for (const t of grid.children) {
                const r = t.getBoundingClientRect();
                if (r.bottom < view.top || r.top > view.bottom) continue;
                const d = Math.abs((r.top + r.bottom) / 2 - midY);
                if (d < best) { best = d; el = t; }
            }
        }
        return el ? { el, top: el.getBoundingClientRect().top } : null;
    },

    // Tiles scrolled out of sight aren't laid out (content-visibility), so
    // they need the real tile size to stand in at, or rows above you change
    // height and the grid jumps. The size is the column width, which the
    // slider sets only as a minimum.
    syncGridTile() {
        const grid = this.elements.gridView;
        if (!grid.clientWidth) return;
        // The selection bar centers on the grid, less its scrollbar
        document.documentElement.style.setProperty('--grid-scrollbar', `${grid.offsetWidth - grid.clientWidth}px`);
        const first = parseFloat(getComputedStyle(grid).gridTemplateColumns);
        if (first > 0) document.documentElement.style.setProperty('--grid-tile', `${first}px`);
    },

    getGridColumnCount() {
        // Read the resolved track list — tile size follows the slider, so a
        // hard-coded width sent Up/Down to the wrong photo after resizing
        const cols = getComputedStyle(this.elements.gridView).gridTemplateColumns;
        const count = cols && cols !== 'none' ? cols.split(' ').filter(Boolean).length : 1;
        return Math.max(1, count);
    },

    rotateCurrent(deg) {
        this.rotateImage(this.currentFile, deg);
    },

    refreshThumbnailUI(file) {
        if (!file) return;

        // 1. Refresh Strip Item
        const stripDiv = file._stripEl;
        if (stripDiv && stripDiv.isConnected) {
            stripDiv.innerHTML = '';
            Flags.decorate(stripDiv, file);
            Edits.decorate(stripDiv, file);
            this.loadStripThumbnail(file, stripDiv, true);
        }

        // 2. Refresh Grid Item
        const gridDiv = file._gridEl;
        if (gridDiv && gridDiv.isConnected) {
            gridDiv.innerHTML = '';
            // Recreate Image
            const img = document.createElement('img');
            img._file = file;
            img.alt = file.name;
            img.src = this.BLANK_THUMB;
            gridDiv.appendChild(img);
            this.showThumbSpinner(gridDiv, img);

            // Re-observe
            const gridObserver = this.elements.gridView._observer;
            if (gridObserver) gridObserver.observe(img);

            Folders.addChip(gridDiv, file);
            Flags.decorate(gridDiv, file);
            Edits.decorate(gridDiv, file);

            // Force reload
            this.loadImageThumbnail(file, img, true);
        }
    },

    // ---- Rotation engine ----
    //
    // The preview is decoupled from the disk write. A rotation request:
    //   1. bumps file.pendingRotation and instantly CSS-rotates every preview
    //      of that file (grid tile, strip thumb, single view) — repeated
    //      clicks stack naturally (90 + 90 shows 180 immediately);
    //   2. a per-file queue drains pendingRotation to disk in the background.
    //
    // Saving an EXIF rotation doesn't change any pixels, so cached preview
    // bitmaps stay valid: we track how far each cached bitmap "lags" behind
    // the disk (thumbLag; per element in the single view) and keep
    // compensating with CSS. Nothing
    // is re-read or re-decoded after a rotation — that's what makes it snappy.
    // Lags reset to 0 whenever a preview is regenerated from fresh disk bytes.

    async rotateBulk(deg) {
        if (this.selection.size === 0) return;
        if (!this.ensureWritable()) return;

        // Snapshot the selection NOW: photos the user clicks or selects while
        // this batch is saving must never join it.
        const snapshot = [...this.selection];
        const filesToRotate = snapshot.filter(f => !/\.gif$/i.test(f.name));
        const skippedGifs = snapshot.length - filesToRotate.length;
        if (skippedGifs > 0) this.showToast(`Skipped ${skippedGifs} GIF${skippedGifs > 1 ? 's' : ''} (rotation would lose animation)`);
        if (filesToRotate.length === 0) return;
        if (Edits.on()) {
            if (this.editsSaving()) return;
            // Kept with the other edits until they're saved
            Edits.rotate(filesToRotate, deg);
            const n = filesToRotate.length;
            this.showToast(`Turned ${n} photo${n > 1 ? 's' : ''} ${Math.abs(deg) === 180 ? '180°' : deg > 0 ? 'right' : 'left'}`, 1600);
            return;
        }

        // One undo step for the whole selection (added to the history now,
        // filled as each photo is saved)
        let batchDone;
        const group = { type: 'group', label: 'rotation', items: [], count: filesToRotate.length, done: new Promise(res => { batchDone = res; }) };
        if (filesToRotate.length > 1) {
            this.pushUndo(group);
            for (const file of filesToRotate) file._undoGroup = group;
        }

        // Instant preview on every selected photo, before any disk work
        for (const file of filesToRotate) {
            file.pendingRotation = (file.pendingRotation || 0) + deg;
            this.applyPreviewRotation(file);
        }

        // Each batch is its own task; overlapping batches stack in the
        // task pill (hover it to see every running task)
        const taskKey = 'rotate-batch-' + (this._batchSeq = (this._batchSeq || 0) + 1);
        const label = `${filesToRotate.length} photo${filesToRotate.length > 1 ? 's' : ''}`;
        this.beginTask(taskKey, `Rotating ${label}…`);

        // Save a few files at a time (rotations only read file headers now,
        // so memory stays flat); files already being saved by another batch
        // are awaited, not double-processed.
        let ok = true;
        let next = 0, done = 0;
        const worker = async () => {
            while (next < filesToRotate.length) {
                const file = filesToRotate[next++];
                try {
                    ok = (await this.processRotationQueue(file)) && ok;
                } finally {
                    if (file._undoGroup === group) file._undoGroup = null;
                }
                done++;
                if (filesToRotate.length >= 50 && done % 25 === 0) {
                    this.updateTask(taskKey, `Rotating ${done}/${filesToRotate.length}…`);
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(4, filesToRotate.length) }, worker));

        this.endTask(taskKey);
        batchDone();
        // Nothing was saved (all failed): no empty undo step
        if (!group.items.length) this._undoStack = (this._undoStack || []).filter(e => e !== group);
        const how = Math.abs(deg) === 180 ? '180°' : deg > 0 ? 'right' : 'left';
        this.showToast(ok ? `Rotated ${label} ${how}` : 'Some photos failed to rotate', 2000);
        this.log('Bulk rotation finished');
    },

    rotateImage(fileEntry, deg) {
        if (!fileEntry) return Promise.resolve(false);
        if (!this.ensureWritable()) return Promise.resolve(false);

        if (/\.gif$/i.test(fileEntry.name)) {
            this.showToast('GIF rotation is not supported (animation would be lost)');
            return Promise.resolve(false);
        }
        // Kept with the other edits until they're saved
        if (Edits.on()) return Promise.resolve(!this.editsSaving() && Edits.rotate([fileEntry], deg));

        // Instant, stacking preview; the save happens in the background
        fileEntry.pendingRotation = (fileEntry.pendingRotation || 0) + deg;
        this.applyPreviewRotation(fileEntry);

        return this.processRotationQueue(fileEntry);
    },

    // One save queue per file. Returns the in-flight promise if the file is
    // already being saved, so concurrent callers await the same drain.
    processRotationQueue(fileEntry) {
        if (fileEntry._rotationQueue) return fileEntry._rotationQueue;
        fileEntry._rotationQueue = this.drainRotationQueue(fileEntry)
            .finally(() => { fileEntry._rotationQueue = null; });
        return fileEntry._rotationQueue;
    },

    async drainRotationQueue(fileEntry) {
        fileEntry.isBusy = true;
        let undoEntry = null;
        try {
            // Process ALL queued rotations for this file (more may arrive
            // while a write is in flight — the loop picks them up)
            while (fileEntry.pendingRotation !== 0) {
                const currentDeg = fileEntry.pendingRotation;
                fileEntry.pendingRotation = 0;
                fileEntry.savingRotation = currentDeg;

                const normalizedDeg = ((currentDeg % 360) + 360) % 360;
                if (normalizedDeg === 0) { fileEntry.savingRotation = 0; continue; }

                // HARDENING: Fresh handle check
                const fileData = await fileEntry.handle.getFile();
                const isJpeg = /\.jpe?g$/i.test(fileEntry.name);
                // The version the cached thumbnail and preview were made
                // from; they're carried over to the new one after the save
                if (!fileEntry._cacheFrom) {
                    fileEntry._cacheFrom = { size: fileData.size, lastModified: fileData.lastModified, saved: fileEntry._savedRotationTotal || 0 };
                }
                const startUndo = (entry) => {
                    if (undoEntry || fileEntry._undoing) return;
                    undoEntry = entry;
                    // Part of a selection being rotated: one undo step for all
                    if (fileEntry._undoGroup) fileEntry._undoGroup.items.push(entry);
                    else this.pushUndo(entry);
                };
                const verify = () => this.dirHandle
                    ? this.verifyPermission(this.dirHandle, true)
                    : this.verifyPermission(fileEntry.handle, true);

                // Fastest path: the JPEG already has an orientation tag, so
                // only those two bytes change. They're written in place; the
                // browser copies the rest of the file natively, so nothing
                // beyond the header is read into memory (big scans, bulk
                // rotations). Undone by rotating back — no copy kept.
                let written = false;
                if (isJpeg) {
                    const patch = await this.orientationPatch(fileData, normalizedDeg);
                    if (patch) {
                        startUndo({ type: 'rotate', file: fileEntry, deg: 0, label: 'rotation' });
                        await verify();
                        written = await this.writeInPlace(fileEntry.handle, patch);
                    }
                }

                if (!written) {
                    const originalBuf = await fileData.arrayBuffer();
                    // Lossless rewrite (adds an orientation tag to a JPEG that
                    // has none — typical scanner output); this doesn't touch
                    // originalBuf, so it can still serve as the undo copy.
                    let blob = null;
                    if (isJpeg) {
                        try {
                            blob = this.rotateJpegLossless(originalBuf, normalizedDeg);
                        } catch (e) {
                            this.log('Lossless rotation unavailable, re-encoding: ' + e.message);
                        }
                    }
                    if (blob) {
                        startUndo({ type: 'rotate', file: fileEntry, deg: 0, label: 'rotation' });
                    } else {
                        // Re-encoding: undo needs the original bytes
                        startUndo({ type: 'bytes', file: fileEntry, blob: new Blob([originalBuf], { type: fileData.type }), label: 'rotation' });
                        // Slow path, so it registers in the task pill
                        this.beginTask('rot:' + fileEntry.name, `Rotating ${fileEntry.name}…`);
                        try {
                            blob = await this.rotateByReencoding(fileData, fileEntry.name, normalizedDeg);
                        } finally {
                            this.endTask('rot:' + fileEntry.name);
                        }
                    }
                    if (!blob) throw new Error('Blob conversion failed');
                    await verify();
                    const writable = await fileEntry.handle.createWritable();
                    await writable.write(blob);
                    await writable.close();
                }

                // Refresh sort metadata — the write changed both
                const newFileData = await fileEntry.handle.getFile();
                fileEntry.size = newFileData.size;
                fileEntry.lastModified = newFileData.lastModified;

                // The cached previews still show pre-save pixels; they now lag
                // the disk by currentDeg more. On-screen totals are unchanged,
                // so nothing needs repainting, reloading or re-decoding.
                fileEntry.thumbLag = (fileEntry.thumbLag || 0) + currentDeg;
                // Running total of saved rotation — preview loaders snapshot
                // this around their disk read to compute an exact lag even if
                // a save lands while they are decoding.
                fileEntry._savedRotationTotal = (fileEntry._savedRotationTotal || 0) + currentDeg;
                fileEntry.savingRotation = 0;
                if (undoEntry && undoEntry.type === 'rotate') undoEntry.deg += currentDeg;
            }
            return true;
        } catch (err) {
            console.error('Rotation failed:', err);
            // Nothing was written: drop an undo entry that would undo nothing
            if (undoEntry && undoEntry.type === 'rotate' && undoEntry.deg === 0) {
                this._undoStack = (this._undoStack || []).filter(e => e !== undoEntry);
            }
            // Roll back the optimistic preview so the screen matches disk
            fileEntry.pendingRotation = 0;
            fileEntry.savingRotation = 0;
            this.applyPreviewRotation(fileEntry);
            this.showToast('Rotation failed: File may be in use');
            return false;
        } finally {
            fileEntry.isBusy = false;
            // Saved: bring the cached thumbnail and preview along
            if (fileEntry._cacheFrom) this.queueCacheCarry(fileEntry);
        }
    },

    // ---- Keeping caches through rotations ----
    //
    // Thumbnails and previews are cached per file version (size + date), and
    // saving a rotation changes both — so reopening a folder after rotating
    // a batch made every rotated photo again from the full scan. Only the
    // orientation changed, not the pixels: once a rotation is saved, the
    // cached copies (JPEGs themselves) get the same lossless orientation tag
    // and are stored under the new version. No decoding, so it's quick, and
    // it runs in the background.

    CARRY_CONCURRENCY: 2,

    queueCacheCarry(file) {
        if (!this._carryQueue) this._carryQueue = new Set();
        this._carryQueue.add(file);
        this.pumpCacheCarry();
    },

    pumpCacheCarry() {
        this._carrying = this._carrying || 0;
        while (this._carrying < this.CARRY_CONCURRENCY && this._carryQueue.size) {
            const file = this._carryQueue.values().next().value;
            this._carryQueue.delete(file);
            this._carrying++;
            this.carryCache(file).catch(e => this.log('Cache carry failed: ' + e.message))
                .finally(() => {
                    this._carrying--;
                    this.pumpCacheCarry();
                });
        }
    },

    carryCache(file) {
        if (!file._carryPromise) {
            file._carryPromise = this.doCarryCache(file).finally(() => { file._carryPromise = null; });
        }
        return file._carryPromise;
    },

    async doCarryCache(file) {
        const from = file._cacheFrom;
        // Mid-save: the save queues this again when it's done
        if (!from || file.isBusy || file.pendingRotation || file.savingRotation) return;
        const saved = file._savedRotationTotal || 0;
        const data = await file.handle.getFile();
        // Only on top of bytes the rotation engine wrote itself (a crop or
        // undo since then made the old copies wrong for this file)
        // ...and only when they changed (a save that failed wrote nothing)
        if (data.size !== file.size || data.lastModified !== file.lastModified ||
            (data.size === from.size && data.lastModified === from.lastModified)) {
            if (file._cacheFrom === from) file._cacheFrom = null;
            return;
        }
        const deg = (((saved - from.saved) % 360) + 360) % 360;
        const turn = async (blob) => {
            if (!blob) return null;
            const buf = await blob.arrayBuffer();
            const b = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
            if (b[0] !== 0xFF || b[1] !== 0xD8) return null; // not a JPEG (photos with transparency): made again when needed
            if (deg === 0) return new Blob([buf], { type: 'image/jpeg' });
            try {
                return this.rotateJpegLossless(buf, deg);
            } catch (e) {
                return null;
            }
        };
        const rel = file.relPath || file.name;

        let thumb = null;
        const thumbKey = `${rel}|${data.size}|${data.lastModified}`;
        if (from.size > this.THUMB_FAST_PATH_BYTES && data.size > this.THUMB_FAST_PATH_BYTES) {
            const oldKey = `${rel}|${from.size}|${from.lastModified}`;
            thumb = await turn(await this.idbGetThumb(oldKey) || await FolderCache.getThumb(this, oldKey));
        }
        const edge = this.previewEdge();
        const oldPreviewKey = `p|${rel}|${from.size}|${from.lastModified}|${edge}`;
        const oldPreview = await this.idbGet('previews', oldPreviewKey);
        const preview = oldPreview && await turn(oldPreview.blob);

        // Another rotation started meanwhile: it carries again from `from`
        if (file._cacheFrom !== from || file.isBusy || (file._savedRotationTotal || 0) !== saved) return;
        if (thumb) {
            this.idbPutThumb(thumbKey, thumb);
            FolderCache.putThumb(this, thumbKey, thumb);
        }
        if (preview) {
            const swap = deg % 180 !== 0;
            this.idbPutPreview(`p|${rel}|${data.size}|${data.lastModified}|${edge}`,
                { blob: preview, w: swap ? oldPreview.h : oldPreview.w, h: swap ? oldPreview.w : oldPreview.h });
            this.idbDelete('previews', oldPreviewKey);
        }
        file._cacheFrom = null;
    },

    // ---- Undo ----
    UNDO_LIMIT: 50,
    UNDO_MAX_BYTES: 256 * 1024 * 1024, // file copies kept for undo (crops, re-encodes)

    // Put one photo back: a rotation is turned back, a re-encode restored
    async undoFileEdit(entry) {
        const f = entry.file;
        if (f._rotationQueue) await f._rotationQueue;
        if (entry.type === 'bytes') {
            f.pendingRotation = 0;
            f.savingRotation = 0;
            const writable = await f.handle.createWritable();
            await writable.write(entry.blob);
            await writable.close();
            await this.afterFileChanged(f);
            return;
        }
        f._undoing = true; // the reverse rotation isn't itself undoable
        try {
            f.pendingRotation = (f.pendingRotation || 0) - entry.deg;
            this.applyPreviewRotation(f);
            if (!(await this.processRotationQueue(f))) throw new Error('could not rotate back');
        } finally {
            f._undoing = false;
        }
    },

    pushUndo(entry) {
        if (!this._undoStack) this._undoStack = [];
        const stack = this._undoStack;
        if (!entry.at) entry.at = Date.now(); // for the undo history (history.js)
        stack.push(entry);
        while (stack.length > this.UNDO_LIMIT ||
            (stack.length > 1 && this.undoBytes() > this.UNDO_MAX_BYTES)) stack.shift();
        History.changed();
    },

    undoBytes() {
        const size = (e) => (e.blob ? e.blob.size : 0) + (e.items ? e.items.reduce((n, it) => n + size(it), 0) : 0);
        return (this._undoStack || []).reduce((n, e) => n + size(e), 0);
    },

    // The newest step taken back. True when it was (the undo history
    // goes back several steps through this)
    async undo() {
        const entry = (this._undoStack || []).pop();
        this._undoError = null;
        if (!entry) {
            this.showToast('Nothing to undo');
            return false;
        }
        History.changed();
        try {
            if (entry.type === 'bytes') {
                await this.undoFileEdit(entry);
                this.showToast(`Undid ${entry.label} on ${entry.file.name}`);
            } else if (entry.type === 'rotate') {
                await this.undoFileEdit(entry);
                this.showToast(`Undid rotation on ${entry.file.name}`);
            } else if (entry.type === 'group') {
                // A rotation of a whole selection: every photo, in one step
                // (once the batch has finished saving, so none are missed)
                await entry.done;
                const items = entry.items.slice();
                let next = 0, failed = 0;
                const worker = async () => {
                    while (next < items.length) {
                        const it = items[next++];
                        try { await this.undoFileEdit(it); } catch (e) { console.error('Undo failed for', it.file.name, e); failed++; }
                    }
                };
                const many = items.length > 1;
                if (many) this.beginTask('undo-group', `Undoing rotation of ${items.length} photos…`);
                try {
                    await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker));
                } finally {
                    if (many) this.endTask('undo-group');
                }
                if (failed) throw new Error(`${failed} photo${failed === 1 ? '' : 's'} could not be put back`);
                this.showToast(`Undid rotation on ${items.length} photo${items.length === 1 ? '' : 's'}`);
            } else if (entry.type === 'rename') {
                await this.renameFile(entry.file, entry.oldName, { skipUndo: true });
                this.showToast('Rename undone');
            } else if (entry.type === 'batch-rename') {
                const ok = await this.renameMany(entry.items.map(it => ({ file: it.file, newName: it.oldName })), { skipUndo: true });
                if (!ok) throw new Error('could not restore the old names');
                this.showToast(`Rename undone (${entry.items.length} file${entry.items.length === 1 ? '' : 's'})`);
            } else if (entry.type === 'flags') {
                Flags.undo(entry);
            } else if (entry.type === 'auto-crop') {
                await this.undoAutoCrop(entry);
            } else if (entry.type === 'edits') {
                Edits.undo(entry);
            } else if (entry.type === 'saved-edits') {
                await this.undoSavedEdits(entry);
            } else if (entry.type === 'relocate' || entry.type.startsWith('folder-')) {
                await Folders.undo(entry);
            } else if (entry.type === 'transfer') {
                await Windows.undo(entry);
            } else if (entry.type === 'trash') {
                const n = await this.restoreManyFromTrash(entry.items);
                this.sortFiles();
                if (n < entry.items.length) this.showToast(`Restored ${n} of ${entry.items.length} photos — the rest are still in ${FolderCache.native() ? 'the Recycle Bin' : '.jeditor/trash'}`, 4000);
                else this.showToast(`Restored ${n} photo${n > 1 ? 's' : ''}`);
            }
        } catch (e) {
            console.error('Undo failed:', e);
            this._undoError = e.message;
            this.showToast('Undo failed: ' + e.message);
            return false;
        } finally {
            History.changed();
        }
        return true;
    },

    // A file's bytes changed outside the rotation pipeline (undo/restore):
    // reset rotation bookkeeping and regenerate previews from disk.
    async afterFileChanged(f) {
        const newData = await f.handle.getFile();
        f.size = newData.size;
        f.lastModified = newData.lastModified;
        f.pendingRotation = 0;
        f.savingRotation = 0;
        f.thumbLag = 0;
        f._exif = undefined;
        f._exifReading = null;
        f.dateTaken = undefined;
        f._dims = undefined;
        f._glass = undefined;
        f._fp = undefined;
        f._cacheFrom = null; // new pixels: nothing to carry over
        f._thumbStale = true; // cached thumbnail shows the old pixels until regenerated
        if (f.fullImageUrl) {
            URL.revokeObjectURL(f.fullImageUrl);
            delete f.fullImageUrl;
        }
        if (f._preview) {
            URL.revokeObjectURL(f._preview.url);
            delete f._preview;
        }
        f._sourceGen = (f._sourceGen || 0) + 1; // in-flight decodes of old bytes won't be cached
        f._sourcePromise = null;
        f._decodePromise = null;
        this.dropDecoded(f);
        this.refreshThumbnailUI(f);
        this.applyPreviewRotation(f);
        if (this.currentFile === f && this.viewMode === 'single') this.loadFile(f);
        if (this._infoOpen && this.currentFile === f) this.fillInfoPanel(f);
    },

    // ---- Trash (safe delete) ----
    //
    // In the Windows app, deleted photos go to the Recycle Bin, all in one
    // go, and Ctrl+Z takes them back out. Elsewhere, and on a drive with no
    // Recycle Bin (network, USB), they're moved into the order's trash/
    // (folder-cache.js): a rename on disk, instant even for big scans, or a
    // copy and delete where moving isn't possible. Several at a time, and the
    // screen is updated once at the end, so deleting hundreds of photos
    // takes seconds.

    TRASH_CONCURRENCY: 6,

    async moveToTrash(files) {
        let list = [...new Set(files.filter(Boolean))];
        if (!list.length) return;
        if (!this.ensureWritable()) return;
        if (!this.dirHandle) {
            this.showToast('Deleting requires opening a folder (not loose files)');
            return;
        }
        const many = list.length > 1;
        if (many) this.beginTask('trash', `Deleting 0/${list.length}`);
        const moved = new Set();
        const undoItems = [];
        const alreadyGone = [];
        let failed = 0, binned = 0;
        try {
            // The Recycle Bin first, where there is one
            if (FolderCache.native()) {
                await Promise.all(list.map(f => f._rotationQueue
                    ? this.withTimeout(f._rotationQueue, this.TRASH_TIMEOUT_MS, 'Waiting for a rotation').catch(() => { }) : null));
                const results = await this.recycleFiles(list);
                const rest = [];
                for (const f of list) {
                    const r = results.get(f) || {};
                    if (r.token) {
                        moved.add(f);
                        undoItems.push({ file: f, recycled: r.token });
                        binned++;
                    } else if (r.gone) {
                        alreadyGone.push(f);
                    } else if (r.noBin) {
                        rest.push(f);
                    } else {
                        console.error('Recycle failed for', f.name, r.error);
                        failed++;
                    }
                }
                list = rest;
                if (many) this.updateTask('trash', `Deleting ${moved.size + alreadyGone.length + failed}/${moved.size + alreadyGone.length + failed + list.length}`);
            }
            if (list.length) failed += await this.trashIntoFolder(list, { moved, undoItems, alreadyGone });
        } finally {
            if (many) this.endTask('trash');
        }
        Flags.forgetFiles(alreadyGone);
        Edits.forgetFiles(alreadyGone);
        this.removeFilesFromApp([...moved].concat(alreadyGone));

        if (undoItems.length) {
            this.pushUndo({ type: 'trash', items: undoItems });
            const n = undoItems.length;
            const where = binned === n ? 'the Recycle Bin' : binned ? 'the Recycle Bin and jEditor\'s trash' : FolderCache.native() ? 'jEditor\'s trash (this drive has no Recycle Bin)' : 'the trash (.jeditor/trash)';
            this.showToast(`Moved ${n} to ${where} — Ctrl+Z to restore`, 4000);
        }
        if (alreadyGone.length) {
            const n = alreadyGone.length;
            this.showToast(`${n} photo${n === 1 ? ' was' : 's were'} already deleted elsewhere`, 3500, null, null, { type: 'info' });
        }
        if (failed) {
            this.showToast(`Couldn't delete ${failed} photo${failed === 1 ? '' : 's'} — press R to check the folder`, 5000);
            Watch.request({ full: true }); // see what's really there
        }
    },

    // In the Windows app: photos to the Recycle Bin, in one go. → Map of
    // photo → { token } (Ctrl+Z restores it with this), { noBin } (its drive
    // has no Recycle Bin), { gone } (deleted already) or { error }
    async recycleFiles(files) {
        const out = new Map();
        const native = FolderCache.native();
        if (!native || !files.length) return out;
        const root = await FolderCache.orderPath(this);
        if (!root) {
            files.forEach(f => out.set(f, { noBin: true })); // where it is isn't known: jEditor's trash
            return out;
        }
        const ready = [];
        for (const f of files) {
            try {
                await f.handle.getFile(); // still there?
                const rel = (f.relPath || f.name).split('/').join('\\');
                ready.push({ f, path: root.replace(/\\$/, '') + '\\' + rel });
            } catch (e) {
                out.set(f, e && e.name === 'NotFoundError' ? { gone: true } : { error: e.message });
            }
        }
        if (!ready.length) return out;
        let results;
        try {
            results = await native.recycle(ready.map(r => r.path));
        } catch (e) {
            results = [];
            ready.forEach(r => out.set(r.f, { error: e.message }));
        }
        ready.forEach((r, i) => { if (results[i]) out.set(r.f, results[i]); });
        return out;
    },

    // Photos into the order's trash/ (no Recycle Bin). Fills in what was
    // moved; → how many failed
    async trashIntoFolder(list, { moved, undoItems, alreadyGone }) {
        let trashDir;
        try {
            trashDir = await FolderCache.trashDir(this);
        } catch (e) {
            console.error('Trash unavailable:', e);
            this.showToast('Delete failed: ' + e.message);
            return list.length;
        }
        // Names already in the trash: one listing, not a lookup per photo
        const taken = new Set();
        try { for await (const e of trashDir.values()) taken.add(e.name.toLowerCase()); } catch (e) { /* empty */ }
        const many = list.length > 1;
        let failed = 0, next = 0, done = 0;
        const stamp = Date.now();
        const worker = async () => {
            while (next < list.length) {
                const i = next++;
                const f = list[i];
                try {
                    if (f._rotationQueue) await this.withTimeout(f._rotationQueue, this.TRASH_TIMEOUT_MS, 'Waiting for a rotation').catch(() => { });
                    let trashName = f.name;
                    if (taken.has(trashName.toLowerCase())) trashName = `${stamp}_${i}_${f.name}`; // avoid collision
                    taken.add(trashName.toLowerCase());
                    // One file Windows never answers for mustn't hold up the rest
                    await this.withTimeout(this.trashOne(f, trashDir, trashName), this.TRASH_TIMEOUT_MS, `Deleting ${f.name}`);
                    moved.add(f);
                    undoItems.push({ file: f, trashDir, trashName });
                } catch (e) {
                    if (e && e.name === 'NotFoundError') {
                        // Deleted already (in File Explorer, say): just take it off the screen
                        alreadyGone.push(f);
                    } else {
                        (e && e.name === 'TimeoutError' ? console.warn : console.error)('Trash failed for', f.name, e);
                        failed++;
                    }
                }
                done++;
                if (many && (done % 10 === 0 || done === list.length)) this.updateTask('trash', `Deleting ${done}/${list.length}`);
            }
        };
        await Promise.all(Array.from({ length: Math.min(this.TRASH_CONCURRENCY, list.length) }, worker));
        return failed;
    },

    TRASH_TIMEOUT_MS: 30000,

    // Rejects with a TimeoutError if `promise` hasn't settled in `ms`
    withTimeout(promise, ms, what) {
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => {
                const e = new Error(`${what} timed out`);
                e.name = 'TimeoutError';
                reject(e);
            }, ms);
        });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    },

    // One photo into the trash: move it, or copy then delete
    async trashOne(f, trashDir, trashName) {
        if (typeof f.handle.move === 'function') {
            try {
                await f.handle.move(trashDir, trashName);
                return;
            } catch (e) {
                if (e && e.name === 'NotFoundError') throw e; // the photo is gone
                // moving not supported here: copy instead
            }
        }
        const data = await f.handle.getFile(); // NotFoundError if it's gone already
        const th = await trashDir.getFileHandle(trashName, { create: true });
        const w = await th.createWritable();
        await w.write(data);
        await w.close();
        await (f.parentDir || this.dirHandle).removeEntry(f.name);
    },

    removeFileFromApp(f) {
        this.removeFilesFromApp([f]);
    },

    // Take photos out of the folder view in one pass
    removeFilesFromApp(gone) {
        if (!gone.length) return;
        if (gone.some(f => f._edit)) setTimeout(() => Edits.updateBar(), 0);
        const set = new Set(gone);
        const cur = this.currentFile;
        const wasCurrent = set.has(cur);
        // The photo after the current one (or before it) takes its place
        let next = null;
        if (wasCurrent) {
            const view = this.viewFiles();
            const idx = view.indexOf(cur);
            for (let i = idx + 1; i < view.length && !next && idx !== -1; i++) if (!set.has(view[i])) next = view[i];
            for (let i = idx - 1; i >= 0 && !next; i--) if (!set.has(view[i])) next = view[i];
        }
        let w = 0;
        for (const f of this.files) if (!set.has(f)) this.files[w++] = f;
        this.files.length = w;
        for (const f of gone) {
            this.selection.delete(f);
            if (f._gridEl) f._gridEl.remove();
            if (f._stripEl) f._stripEl.remove();
        }

        if (this.files.length === 0 && this.dirHandle && !this.readOnlyMode) {
            // The last photo went: the project stays open, empty
            this.currentFile = null;
            this.setView('grid');
            this.renderGrid();
            Folders.showEmptyHeader();
        } else if (this.files.length === 0) {
            this.currentFile = null;
            this.updateStatusBar();
            this.elements.mainInterface.classList.add('hidden');
            this.elements.dropZone.classList.remove('hidden');
        } else if (wasCurrent && next) {
            if (this.viewMode === 'single') {
                this.loadFile(next);
            } else {
                this.currentFile = next;
                this.updateStatusBar();
            }
        }
        this.updateSelectionUI();
        if (this.getCurrentIndex() !== -1) this.updateFileCount();
        if (wasCurrent && !next && this.files.length) {
            // The last photo of the folder being shown went
            if (this.viewMode === 'single') this.setView('grid');
            else Folders.showEmptyHeader();
        }
        Folders.render();
    },

    // Put a photo back from the trash (undo): out of the Recycle Bin, or
    // moved back from trash/, or copied
    async restoreFromTrash(item) {
        const { file, trashDir, trashName } = item;
        const dest = file.parentDir || this.dirHandle;
        let nh = null;
        if (item.recycled) {
            const [r] = await FolderCache.native().restore([item.recycled]);
            if (!r || r.error) throw new Error((r && r.error) || 'not restored');
            nh = await dest.getFileHandle(file.name);
        }
        const th = nh ? null : await trashDir.getFileHandle(trashName);
        if (!nh && typeof th.move === 'function') {
            try {
                await th.move(dest, file.name);
                nh = th;
            } catch (e) { /* copy instead */ }
        }
        if (!nh) {
            const data = await th.getFile();
            nh = await dest.getFileHandle(file.name, { create: true });
            const w = await nh.createWritable();
            await w.write(data);
            await w.close();
            await trashDir.removeEntry(trashName);
        }
        file.handle = nh;
        const nd = await nh.getFile();
        file.size = nd.size;
        file.lastModified = nd.lastModified;
        this.files.push(file);
        if (this.elements.mainInterface.classList.contains('hidden') && this.files.length) {
            this.elements.mainInterface.classList.remove('hidden');
            this.elements.dropZone.classList.add('hidden');
        }
    },

    async restoreManyFromTrash(items) {
        const many = items.length > 1;
        if (many) this.beginTask('restore', `Restoring 0/${items.length}`);
        let next = 0, done = 0, failed = 0;
        const worker = async () => {
            while (next < items.length) {
                const it = items[next++];
                try {
                    await this.restoreFromTrash(it);
                } catch (e) {
                    console.error('Restore failed for', it.file.name, e);
                    failed++;
                }
                done++;
                if (many && (done % 10 === 0 || done === items.length)) this.updateTask('restore', `Restoring ${done}/${items.length}`);
            }
        };
        try {
            await Promise.all(Array.from({ length: Math.min(this.TRASH_CONCURRENCY, items.length) }, worker));
        } finally {
            if (many) this.endTask('restore');
        }
        return items.length - failed;
    },

    // ---- Capture-date sort support ----

    // One reading at a time: a second call (each keystroke in Rename) waits
    // for the one running, rather than taking dates still being read as none
    async ensureDatesTaken() {
        while (this._readingDates) await this._readingDates;
        const missing = this.files.filter(f => f.dateTaken === undefined);
        if (!missing.length) return;
        this.beginTask('taken', 'Reading capture dates…');
        let i = 0;
        const workers = Array.from({ length: 8 }, async () => {
            while (i < missing.length) {
                const f = missing[i++];
                const exif = await this.getExifInfo(f);
                f.dateTaken = (exif && exif.dateTaken) ? exif.dateTaken.getTime() : (f.lastModified || 0);
            }
        });
        this._readingDates = Promise.all(workers).finally(() => { this._readingDates = null; this.endTask('taken'); });
        await this._readingDates;
    },

    // ---- Rename ----

    async renameFile(file, newName, { skipUndo = false } = {}) {
        newName = (newName || '').trim();
        if (!file || !newName || newName === file.name) return false;
        if (/[\\/:*?"<>|]/.test(newName)) {
            this.showToast('Name contains invalid characters');
            return false;
        }
        const ext = (file.name.match(/\.\w+$/) || [''])[0];
        if (!/\.\w+$/.test(newName)) newName += ext;
        if (!this.isImage(newName)) {
            this.showToast('Keep an image file extension');
            return false;
        }
        const oldName = file.name;
        const dir = file.parentDir || this.dirHandle;
        try {
            if (file._rotationQueue) await file._rotationQueue;
            // Refuse to overwrite an existing file
            if (dir) {
                let exists = false;
                try { await dir.getFileHandle(newName); exists = true; } catch (e) { /* free */ }
                if (exists) {
                    this.showToast(`"${newName}" already exists`);
                    return false;
                }
            }
            await this.moveFile(file, newName);
            if (!skipUndo) this.pushUndo({ type: 'rename', file, oldName });
            return true;
        } catch (e) {
            console.error('Rename failed:', e);
            this.showToast('Rename failed: ' + e.message);
            return false;
        }
    },

    // Rename on disk without checks (callers make sure the name is free)
    async moveFile(file, newName) {
        const dir = file.parentDir || this.dirHandle;
        const oldName = file.name;
        if (file._rotationQueue) await file._rotationQueue;
        if (typeof file.handle.move === 'function') {
            await file.handle.move(newName);
        } else if (dir) {
            const data = await file.handle.getFile();
            const nh = await dir.getFileHandle(newName, { create: true });
            const w = await nh.createWritable();
            await w.write(data);
            await w.close();
            await dir.removeEntry(oldName);
            file.handle = nh;
        } else {
            throw new Error('No folder access');
        }
        file.name = newName;
        if (file.relPath) file.relPath = file.relPath.replace(/[^/]+$/, newName);
        // Flags or edits left by a photo that once had this name aren't this one's
        Flags.orphans.delete(file.relPath || file.name);
        if (Edits.orphans) Edits.orphans.delete(file.relPath || file.name);
        if (this.currentFile === file) {
            this.elements.fileName.textContent = newName;
            this.updateStatusBar();
            if (this._infoOpen) this.fillInfoPanel(file);
        }
        const gridImg = file._gridEl && file._gridEl.querySelector('img');
        if (gridImg) gridImg.alt = newName;
    },

    // Rename many files at once ([{ file, newName }], names already
    // validated). New names may overlap old ones — shifting a sequence,
    // or a case-only change on Windows — so then every file first moves to
    // a temporary name. If anything fails part-way, all files go back to
    // their original names. One undo step reverts the whole batch.
    async renameMany(pairs, { skipUndo = false } = {}) {
        pairs = pairs.filter(p => p.file && p.newName && p.newName !== p.file.name);
        if (!pairs.length) return true;
        if (!this.ensureWritable()) return false;
        const dirKey = (f) => { const r = f.relPath || f.name; return r.includes('/') ? r.slice(0, r.lastIndexOf('/')) : ''; };
        const original = new Map(pairs.map(p => [p.file, p.file.name]));
        const oldNames = new Set(pairs.map(p => dirKey(p.file) + '/' + p.file.name.toLowerCase()));

        // A target that isn't one of the batch's own names must be free on disk
        for (const p of pairs) {
            if (oldNames.has(dirKey(p.file) + '/' + p.newName.toLowerCase())) continue;
            const dir = p.file.parentDir || this.dirHandle;
            let exists = false;
            try { if (dir) { await dir.getFileHandle(p.newName); exists = true; } } catch (e) { /* free */ }
            if (exists) {
                this.showToast(`"${p.newName}" already exists — nothing was renamed`, 4000);
                return false;
            }
        }

        const twoPass = pairs.some(p => oldNames.has(dirKey(p.file) + '/' + p.newName.toLowerCase()));
        const stamp = Date.now().toString(36);
        const temp = (p, i) => `.jeditor-renaming-${stamp}-${i}${(p.file.name.match(/\.[^.]+$/) || [''])[0]}`;
        const total = pairs.length * (twoPass ? 2 : 1);
        let step = 0;
        const progress = () => {
            step++;
            if (step % 20 === 0 || step === total) this.updateTask('rename', `Renaming ${Math.min(step, total)}/${total}`);
        };
        this.beginTask('rename', `Renaming 0/${total}`);
        const touched = new Set();
        try {
            if (twoPass) {
                for (let i = 0; i < pairs.length; i++) {
                    await this.moveFile(pairs[i].file, temp(pairs[i], i));
                    touched.add(pairs[i].file);
                    progress();
                }
            }
            for (const p of pairs) {
                await this.moveFile(p.file, p.newName);
                touched.add(p.file);
                progress();
            }
        } catch (err) {
            console.warn('Batch rename failed, restoring names:', err);
            // Put everything back: via temporary names, so restored names
            // can't collide with half-finished ones
            const back = [...touched];
            for (let i = 0; i < back.length; i++) {
                try { await this.moveFile(back[i], `.jeditor-restoring-${stamp}-${i}${(back[i].name.match(/\.[^.]+$/) || [''])[0]}`); } catch (e) { /* keep going */ }
            }
            for (const f of back) {
                try { await this.moveFile(f, original.get(f)); } catch (e) { /* reported below */ }
            }
            this.endTask('rename');
            this.showToast(`Rename failed (${err.message}) — names were put back`, 5000);
            return false;
        }
        this.endTask('rename');
        if (!skipUndo) {
            this.pushUndo({ type: 'batch-rename', items: pairs.map(p => ({ file: p.file, oldName: original.get(p.file) })) });
        }
        this.sortFiles();
        return true;
    },

    openRename(files) {
        if (!this.ensureWritable()) return;
        if (!this.dirHandle) {
            this.showToast('Renaming needs a folder opened with Open folder');
            return;
        }
        Renamer.open(this, files);
    },

    promptRename(file = this.currentFile) {
        if (file) this.openRename([file]);
    },

    batchRename(files) {
        this.openRename(files.filter(Boolean));
    },

    // ---- Persistent thumbnail cache (IndexedDB) ----

    idb() {
        if (this._idbPromise !== undefined) return this._idbPromise;
        this._idbPromise = new Promise((resolve) => {
            try {
                const req = indexedDB.open('jeditor', 2);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains('thumbs')) db.createObjectStore('thumbs');
                    if (!db.objectStoreNames.contains('previews')) {
                        db.createObjectStore('previews').createIndex('t', 't');
                    }
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(null);
                req.onblocked = () => resolve(null);
            } catch (e) {
                resolve(null);
            }
        });
        return this._idbPromise;
    },

    async idbGet(store, key) {
        const db = await this.idb();
        if (!db) return null;
        return new Promise((res) => {
            try {
                const req = db.transaction(store, 'readonly').objectStore(store).get(key);
                req.onsuccess = () => res(req.result || null);
                req.onerror = () => res(null);
            } catch (e) {
                res(null);
            }
        });
    },

    idbGetThumb(key) {
        return this.idbGet('thumbs', key);
    },

    async idbDelete(store, key) {
        const db = await this.idb();
        if (!db) return;
        try {
            db.transaction(store, 'readwrite').objectStore(store).delete(key);
        } catch (e) { /* cache is best-effort */ }
    },

    async idbPutThumb(key, blob) {
        const db = await this.idb();
        if (!db) return;
        try {
            db.transaction('thumbs', 'readwrite').objectStore('thumbs').put(blob, key);
        } catch (e) { /* cache is best-effort */ }
    },

    // Previews are ~0.5 MB each, so the store is capped: past the limit the
    // oldest entries are evicted.
    async idbPutPreview(key, rec) {
        const db = await this.idb();
        if (!db) return;
        try {
            const tx = db.transaction('previews', 'readwrite');
            const store = tx.objectStore('previews');
            store.put({ blob: rec.blob, w: rec.w, h: rec.h, t: Date.now() }, key);
            const countReq = store.count();
            countReq.onsuccess = () => {
                let excess = countReq.result - this.PREVIEW_CACHE_MAX;
                if (excess <= 0) return;
                store.index('t').openKeyCursor().onsuccess = (e) => {
                    const cur = e.target.result;
                    if (!cur || excess-- <= 0) return;
                    store.delete(cur.primaryKey);
                    cur.continue();
                };
            };
        } catch (e) { /* cache is best-effort */ }
    },

    // ---- Fullscreen & slideshow ----

    toggleFullscreen() {
        if (document.fullscreenElement) {
            document.exitFullscreen();
        } else {
            document.documentElement.requestFullscreen().catch(() => this.showToast('Fullscreen was blocked'));
        }
    },

    startSlideshow() {
        this.stopSlideshow();
        this.setView('single');
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => { });
        }
        this._slideshowTimer = setInterval(() => this.navigate(1), 3000);
        this.showToast('Slideshow started — press any key to stop', 2500);
    },

    stopSlideshow() {
        if (this._slideshowTimer) {
            clearInterval(this._slideshowTimer);
            this._slideshowTimer = null;
        }
    },

    // ---- Rubber-band selection in the grid ----

    initRubberBand() {
        const grid = this.elements.gridView;
        let band = null, startX = 0, startY = 0, active = false;

        grid.addEventListener('mousedown', (e) => {
            if (e.button !== 0 || e.target !== grid) return; // background only
            active = true;
            startX = e.clientX;
            startY = e.clientY;
            this._bandBase = (e.ctrlKey || e.metaKey) ? new Set(this.selection) : new Set();
            band = document.createElement('div');
            band.className = 'rubber-band';
            document.body.appendChild(band);
            e.preventDefault();
        });

        window.addEventListener('mousemove', (e) => {
            if (!active || !band) return;
            const x1 = Math.min(startX, e.clientX), y1 = Math.min(startY, e.clientY);
            const x2 = Math.max(startX, e.clientX), y2 = Math.max(startY, e.clientY);
            band.style.left = x1 + 'px';
            band.style.top = y1 + 'px';
            band.style.width = (x2 - x1) + 'px';
            band.style.height = (y2 - y1) + 'px';
            if (this._bandRaf) return;
            this._bandRaf = requestAnimationFrame(() => {
                this._bandRaf = null;
                const sel = new Set(this._bandBase);
                for (const el of grid.children) {
                    if (!el._file) continue; // folder tiles
                    const r = el.getBoundingClientRect();
                    if (r.right > x1 && r.left < x2 && r.bottom > y1 && r.top < y2) sel.add(el._file);
                }
                this.selection = sel;
                this.updateSelectionUI();
            });
        });

        window.addEventListener('mouseup', () => {
            if (!active) return;
            active = false;
            if (band) { band.remove(); band = null; }
        });
    },

    // ---- Export copies ----

    async exportCopies(files) {
        const list = files.filter(Boolean);
        if (!list.length) return;
        if (!this.dirHandle) {
            this.showToast('Export requires opening a folder');
            return;
        }
        const n = list.length;
        const input = await UI.prompt({
            title: n === 1 ? 'Export a copy' : `Export ${n.toLocaleString()} copies`,
            message: 'Copies go to a "jEditor Export" folder inside this one. The originals aren\'t changed.' +
                (list.some(f => f._edit) ? '\n\nPhotos with edits not saved yet are exported with them.' : ''),
            input: { label: 'Longest side in pixels (leave empty for full size)', placeholder: 'Full size', inputMode: 'numeric' },
            ok: 'Export'
        });
        if (input === null) return;
        const maxEdge = parseInt(input, 10) || 0;

        try {
            const dir = await this.dirHandle.getDirectoryHandle('jEditor Export', { create: true });
            let done = 0, failed = 0;
            for (const f of list) {
                try {
                    const data = await f.handle.getFile();
                    let out = f._edit ? await this.renderEdited(f, data) : data;
                    if (maxEdge > 0) {
                        const bmp = await createImageBitmap(data);
                        const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
                        if (scale < 1) {
                            const canvas = document.createElement('canvas');
                            canvas.width = Math.round(bmp.width * scale);
                            canvas.height = Math.round(bmp.height * scale);
                            canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
                            const { type, quality } = this.getSaveFormat(f.name);
                            out = await new Promise(r => canvas.toBlob(r, type, quality));
                        }
                        bmp.close();
                    }
                    if (!out) throw new Error('encode failed');
                    const h = await dir.getFileHandle(f.name, { create: true });
                    const w = await h.createWritable();
                    await w.write(out);
                    await w.close();
                    done++;
                } catch (e) {
                    failed++;
                    console.error('Export failed:', f.name, e);
                }
                this.updateTask('export', `Exporting ${done + failed}/${list.length}`);
            }
            this.endTask('export');
            this.showToast(
                failed ? `Exported ${done}, ${failed} failed` : `Exported ${done} to "jEditor Export"`
            );
        } catch (e) {
            this.endTask('export');
            this.showToast('Export failed: ' + e.message);
        }
    },

    // A photo with its edit not saved yet (edits.js), at full size, as
    // saving it would write it
    async renderEdited(f, data) {
        const edit = f._edit;
        const original = new Uint8Array(await data.arrayBuffer());
        const n = edit.n, eq = (a, b) => Math.abs(a - b) < 1e-6;
        const turnOnly = !edit.angle && eq(n.x0, -0.5) && eq(n.y0, -0.5) && eq(n.x1, 0.5) && eq(n.y1, 0.5);
        if (turnOnly && /\.jpe?g$/i.test(f.name)) {
            try {
                const b = this.rotateJpegLossless(original.buffer, edit.q * 90);
                if (b) return b;
            } catch (e) { /* re-encode */ }
        }
        const { type, quality } = this.getSaveFormat(f.name);
        const canvas = await CropEditor.renderSnapshot(data, edit, type, original);
        if (!canvas) return data;
        const w = canvas.width, h = canvas.height;
        const blob = await new Promise(r => canvas.toBlob(r, type, quality));
        canvas.width = canvas.height = 0;
        if (!blob) throw new Error('encoding failed');
        return ImageMeta.transplant(original, blob, type, w, h);
    },

    // A photo just scanned or shot: open it large once jEditor has it (in
    // another folder than the one showing: that folder). Not while you're
    // cropping, renaming or in a dialog.
    async showWhenIn(rel) {
        const token = (this._showToken = (this._showToken || 0) + 1);
        for (let i = 0; i < 40; i++) {
            if (token !== this._showToken) return; // a newer one came
            const f = this.files.find(x => (x.relPath || x.name) === rel);
            if (f) {
                if (this.cropState.active || UI.isOpen() || Renamer.isOpen) return;
                if (!Folders.inView(f) && Folders.scope !== null && Folders.scope !== undefined) Folders.setScope(Folders.dirOf(f));
                this.openSingle(f);
                return;
            }
            await new Promise(r => setTimeout(r, 150));
        }
    },

    // ---- Context menu ----

    initContextMenu() {
        document.addEventListener('contextmenu', (e) => {
            if (this.cropState.active || Dupes.isOpen) { e.preventDefault(); return; }
            if (this.elements.mainInterface.classList.contains('hidden')) return;
            const folder = this.dirHandle && e.target.closest && e.target.closest('[data-folder-path]');
            if (folder) {
                e.preventDefault();
                this.openContextMenu(Folders.contextItems(folder.dataset.folderPath), e.clientX, e.clientY);
                return;
            }
            const tile = e.target.closest && e.target.closest('.grid-item');
            const inSingle = this.viewMode === 'single' && e.target.closest && e.target.closest('#image-container');
            const inGridBg = this.viewMode === 'grid' && e.target === this.elements.gridView;
            if (!tile && !inSingle && !inGridBg) return;
            e.preventDefault();
            this.openContextMenu(this.buildContextItems(tile, inSingle), e.clientX, e.clientY);
        });
        window.addEventListener('click', () => this.closeContextMenu());
        window.addEventListener('scroll', () => this.closeContextMenu(), true);
        window.addEventListener('resize', () => this.closeContextMenu());
    },

    buildContextItems(tile, inSingle) {
        if (tile) {
            const file = tile._file;
            if (!this.selection.has(file)) {
                this.currentFile = file;
                this.selection = new Set([file]);
                this.updateSelectionUI();
                this.updateStatusBar();
            }
            const sel = [...this.selection];
            if (sel.length > 1) {
                const n = sel.length.toLocaleString();
                return [
                    ['flags', sel],
                    ['—'],
                    [`Rotate ${n} left`, () => this.rotateBulk(-90)],
                    [`Rotate ${n} right`, () => this.rotateBulk(90)],
                    [`Rotate ${n} 180°`, () => this.rotateBulk(180)],
                    [`Auto crop ${n}`, () => this.batchAutoCrop(sel)],
                    ...(sel.some(f => f._edit) ? [[`Discard edits on ${sel.filter(f => f._edit).length.toLocaleString()}`, () => Edits.discard(sel)]] : []),
                    ['—'],
                    [`Move ${n} to…`, () => Folders.openPicker(sel, 'move')],
                    [`Copy ${n} to…`, () => Folders.openPicker(sel, 'copy')],
                    [`Rename ${n}…`, () => this.openRename(sel)],
                    [`Export ${n} copies…`, () => this.exportCopies(sel)],
                    ['—'],
                    [`Delete ${n}`, () => this.moveToTrash(sel), true]
                ];
            }
            return [
                ['flags', [file]],
                ['—'],
                ['Open', () => this.openSingle(file)],
                ['—'],
                ['Rotate left', () => this.rotateImage(file, -90)],
                ['Rotate right', () => this.rotateImage(file, 90)],
                ['Rotate 180°', () => this.rotateImage(file, 180)],
                ['Crop and straighten', () => { this.openSingle(file); this.enterCrop(); }],
                ...(file._edit ? [['Discard edit', () => Edits.discard([file])]] : []),
                ['—'],
                ['Move to…', () => Folders.openPicker([file], 'move')],
                ['Copy to…', () => Folders.openPicker([file], 'copy')],
                ['Rename…', () => this.promptRename(file)],
                ['File info', () => { this.toggleInfoPanel(true, { file }); }],
                ['Export a copy…', () => this.exportCopies([file])],
                ['—'],
                ['Delete', () => this.moveToTrash([file]), true]
            ];
        }
        if (inSingle) {
            const file = this.currentFile;
            return [
                ['flags', [file]],
                ['—'],
                ['Rotate left', () => this.rotateImage(file, -90)],
                ['Rotate right', () => this.rotateImage(file, 90)],
                ['Rotate 180°', () => this.rotateImage(file, 180)],
                ['Crop and straighten', () => this.enterCrop()],
                ...(file && file._edit ? [['Discard edit', () => Edits.discard([file])]] : []),
                ['—'],
                ['Move to…', () => Folders.openPicker([file], 'move')],
                ['Copy to…', () => Folders.openPicker([file], 'copy')],
                ['Rename…', () => this.promptRename(file)],
                ['File info', () => this.toggleInfoPanel(true)],
                ['Export a copy…', () => this.exportCopies([file])],
                ['—'],
                ['Full screen', () => this.toggleFullscreen()],
                ['Start slideshow', () => this.startSlideshow()],
                ['—'],
                ['Delete', () => this.moveToTrash([file]), true]
            ];
        }
        return [
            ['Select all', () => { this.selection = new Set(this.viewFiles()); this.updateSelectionUI(); }],
            ['Clear selection', () => this.clearSelection()],
            ['—'],
            ...(this.dirHandle ? [['New folder…', () => Folders.newFolder()]] : []),
            ['Rename all…', () => this.openRename([])],
            ['Search…', () => Flags.focusSearch()],
            [Folders.scope === null ? 'Project info' : 'Folder info', () => this.toggleInfoPanel(true, { folder: Folders.scope })],
            ...(this.files.some(f => Flags.has(f, 'rescan'))
                ? [['Copy rescan list', () => Flags.copyList(this.files.filter(f => Flags.has(f, 'rescan')), 'rescan')]] : []),
            ['Find duplicates… (WIP)', () => this.openDupes()],
            ['Start slideshow', () => this.startSlideshow()],
            ['Full screen', () => this.toggleFullscreen()],
            ['—'],
            ...(this.dirHandle && !this.readOnlyMode ? [
                [Edits.defer ? 'Save edits straight away' : 'Save edits when done', () => Edits.setDefer(!Edits.defer)],
                ...(Edits.count() ? [['Save edits…', () => Edits.saveAll()]] : [])
            ] : []),
            ['Clean up folder…', () => this.cleanUpFolder()]
        ];
    },

    // The selection bar's ⋯ menu: what doesn't earn a place on the bar
    selectionMoreItems() {
        const sel = [...this.selection];
        const n = sel.length.toLocaleString();
        return [
            ['flags', sel],
            ['—'],
            [`Rotate ${n} 180°`, () => this.rotateBulk(180)],
            [`Copy ${n} to…`, () => Folders.openPicker(sel, 'copy')],
            [sel.length === 1 ? 'Export a copy…' : `Export ${n} copies…`, () => this.exportCopies(sel)],
            ['—'],
            ['Select all', () => { this.selection = new Set(this.viewFiles()); this.updateSelectionUI(); }]
        ];
    },

    // items: [label, action, danger] | ['—'] | ['flags', files]
    // opts.above: x, y is the top-left of the button it opens from; the
    // menu opens upwards from there
    openContextMenu(items, x, y, opts = {}) {
        this.closeContextMenu();
        const menu = document.createElement('div');
        menu.id = 'context-menu';
        menu.setAttribute('role', 'menu');
        items.forEach(([label, action, danger]) => {
            if (label === 'flags') {
                if (this.dirHandle && !this.readOnlyMode) menu.appendChild(Flags.menuRow(action));
                return;
            }
            if (label === '—') {
                if (!menu.lastChild || menu.lastChild.className === 'ctx-divider') return;
                const hr = document.createElement('div');
                hr.className = 'ctx-divider';
                hr.setAttribute('role', 'separator');
                menu.appendChild(hr);
                return;
            }
            const btn = document.createElement('button');
            btn.textContent = label;
            btn.setAttribute('role', 'menuitem');
            if (danger) btn.classList.add('danger');
            btn.onclick = (ev) => {
                ev.stopPropagation();
                this.closeContextMenu();
                action();
            };
            menu.appendChild(btn);
        });
        if (menu.lastChild && menu.lastChild.className === 'ctx-divider') menu.lastChild.remove();
        // Arrow keys move through the items; Esc closes (handleKey)
        menu.addEventListener('keydown', (e) => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
            e.preventDefault();
            e.stopPropagation();
            const all = [...menu.querySelectorAll('button')];
            const i = all.indexOf(document.activeElement);
            const next = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1
                : (i + (e.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length;
            all[next].focus();
        });
        this._menuReturn = document.activeElement;
        document.body.appendChild(menu);
        const r = menu.getBoundingClientRect();
        const top = opts.above ? y - r.height : y;
        menu.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
        menu.style.top = Math.max(8, Math.min(top, window.innerHeight - r.height - 8)) + 'px';
        const first = menu.querySelector('[role="menuitem"]');
        if (first) first.focus({ preventScroll: true });
    },

    closeContextMenu() {
        const menu = document.getElementById('context-menu');
        if (!menu) return;
        const hadFocus = menu.contains(document.activeElement);
        menu.remove();
        if (hadFocus && this._menuReturn && this._menuReturn.isConnected) this._menuReturn.focus({ preventScroll: true });
    },

    // ---- Crop & Straighten (see crop.js) ----

    async enterCrop() {
        const file = this.currentFile;
        if (!file || this.cropState.active) return;
        if (!this.ensureWritable()) return;
        if (this.editsSaving()) return;
        if (/\.gif$/i.test(file.name)) {
            this.showToast('Cropping GIFs is not supported (animation would be lost)');
            return;
        }
        if (this.viewMode !== 'single') this.setView('single');
        // Active from here on: keys go to the editor and rotation is blocked
        this.cropState.active = true;
        this.stopSlideshow();
        try {
            // A rotation still being written must land first — the editor
            // reads the file from disk so what you crop is what gets saved
            if (file._rotationQueue) await file._rotationQueue;
            await CropEditor.open(this, file);
        } catch (err) {
            console.error('Crop open failed:', err);
            this.cancelCrop();
            this.showToast('Could not open this photo for cropping');
        }
    },

    cancelCrop() {
        CropEditor.close();
        this.cropState.active = false;
    },

    getLastCrop() {
        if (this._lastCrop === undefined) {
            try { this._lastCrop = JSON.parse(localStorage.getItem('jeditor.lastCrop') || 'null'); } catch (e) { this._lastCrop = null; }
        }
        return this._lastCrop;
    },

    rememberCrop(snap) {
        this._lastCrop = snap;
        try { localStorage.setItem('jeditor.lastCrop', JSON.stringify(snap)); } catch (e) { /* private mode */ }
    },

    // Save the crop. With next: step to the following photo and open the
    // editor again — the fast path through a scan order.
    async saveCrop({ next = false } = {}) {
        const ed = CropEditor;
        if (!ed.isOpen || !ed.ready || ed.busy) return;
        const file = ed.file;
        const snap = ed.snapshot();

        const goNext = () => {
            if (!next) return;
            if (this.getCurrentIndex() >= this.viewFiles().length - 1) {
                this.showToast('That was the last photo');
                return;
            }
            this.navigate(1);
            this.enterCrop();
        };

        // Save edits when done (edits.js): kept on the photo, not written
        if (Edits.on()) {
            const had = !!file._edit;
            const none = ed.isIdentity() && !ed.q;
            this.rememberCrop(snap);
            this.cancelCrop();
            if (none && !had) this.showToast('No changes', 1500);
            else {
                Edits.set([{ file, edit: none ? null : snap }], 'crop');
                this.showToast(none ? 'Back to the whole photo' : 'Crop kept — saved into the photo when you save the edits', 2200);
            }
            goNext();
            return;
        }

        // Only quarter turns and no crop: that's a rotation — do it
        // losslessly through the rotation engine instead of re-encoding
        if (ed.isIdentity()) {
            const quarter = ed.q;
            this.rememberCrop(snap);
            this.cancelCrop();
            if (quarter) {
                const deg = quarter === 3 ? -90 : quarter * 90;
                this.rotateImage(file, deg);
                this.showToast(`Rotated ${deg > 0 ? 'right' : 'left'}${Math.abs(deg) === 180 ? ' 180°' : ''}`, 1500);
            } else {
                this.showToast('No changes to save', 1500);
            }
            goNext();
            return;
        }

        ed.busy = true;
        this.beginTask('crop-save', 'Saving crop…');
        try {
            const { type, quality } = this.getSaveFormat(file.name);
            const fileData = await file.handle.getFile();
            const original = new Uint8Array(await fileData.arrayBuffer());

            const canvas = await ed.renderOutput(fileData, type, original);
            const w = canvas.width, h = canvas.height;
            let blob = await new Promise(r => canvas.toBlob(r, type, quality));
            canvas.width = canvas.height = 0; // release the full-size buffer now
            if (!blob) throw new Error('encoding failed');
            // Keep EXIF (dates, camera), color profile and DPI
            blob = await ImageMeta.transplant(original, blob, type, w, h);

            if (this.dirHandle) await this.verifyPermission(this.dirHandle, true);
            else await this.verifyPermission(file.handle, true);

            file.isBusy = true;
            try {
                const writable = await file.handle.createWritable();
                await writable.write(blob);
                await writable.close();
            } finally {
                file.isBusy = false;
            }
            this.pushUndo({
                type: 'bytes',
                file,
                blob: new Blob([original], { type: fileData.type }),
                label: 'crop'
            });
            this.rememberCrop(snap);

            // The crop bakes everything upright — reset rotation bookkeeping
            file.pendingRotation = 0;
            file.savingRotation = 0;

            ed.busy = false;
            this.cancelCrop();
            await this.afterFileChanged(file);
            this.showToast(`Saved ${w} × ${h}`, 1800);
            goNext();
        } catch (err) {
            console.error('Crop save failed:', err);
            this.showToast('Failed to save crop: ' + err.message, 4000);
        } finally {
            ed.busy = false;
            this.endTask('crop-save');
        }
    },

    // ---- Batch Auto crop ----
    //
    // Auto (find the print, straighten, crop to it) on many photos at once,
    // in the background, exactly as the crop editor would do it with the
    // aspect ratio last chosen there. Photos where no print edge is found,
    // or that are already cropped to the print, are left alone. The
    // originals are copied to .jeditor/originals first, so one Ctrl+Z puts
    // the whole batch back without holding hundreds of scans in memory.

    AUTO_CROP_CONCURRENCY: 2,

    // ask: false skips the "Auto crop N photos?" question (scans, see
    // scan.js); feeder: they're from a sheet feeder (CropAuto.detectFeeder)
    async batchAutoCrop(files, { ask = true, feeder = false, scan = false } = {}) {
        if (!this.ensureWritable()) return;
        if (!this.dirHandle) {
            this.showToast('Auto crop needs a folder opened with Open folder');
            return;
        }
        const list = [...new Set(files.filter(Boolean))].filter(f => !/\.gif$/i.test(f.name));
        if (!list.length) {
            this.showToast(files.length ? 'GIFs can\'t be cropped (the animation would be lost)' : 'Select some photos first');
            return;
        }
        if (this._autoCropping) {
            this.showToast('Auto crop is already running');
            return;
        }
        if (Edits.on()) return this.editsSaving() ? undefined : this.batchAutoCropKept(list, { feeder, scan });
        if (ask && list.length > 50 && !await UI.confirm({
            title: `Auto crop ${list.length.toLocaleString()} photos?`,
            message: `Each is straightened and cropped to the print found on it. The originals are kept ${FolderCache.native() ? 'by jEditor on this PC' : 'in .jeditor/originals'}, so Ctrl+Z puts them all back.`,
            ok: 'Auto crop'
        })) return;
        this._autoCropping = true;
        const total = list.length;
        const key = 'auto-crop';
        const entry = { type: 'auto-crop', items: [] };
        let done = 0, cropped = 0, noEdge = 0, already = 0, failed = 0;
        const label = () => `Auto crop ${done}/${total}`;
        this.beginTask(key, label());
        try {
            await this.verifyPermission(this.dirHandle, true);
            const root = await FolderCache.root(this, true);
            const backups = await root.getDirectoryHandle('originals', { create: true });
            let next = 0;
            const worker = async () => {
                while (next < list.length) {
                    const f = list[next++];
                    try {
                        const r = await this.autoCropOne(f, backups, { feeder, scan });
                        if (r === 'none') noEdge++;
                        else if (r === 'same') already++;
                        else {
                            cropped++;
                            entry.items.push(r);
                        }
                    } catch (e) {
                        console.error('Auto crop failed for', f.name, e);
                        failed++;
                    }
                    done++;
                    this.updateTask(key, label());
                }
            };
            await Promise.all(Array.from({ length: Math.min(this.AUTO_CROP_CONCURRENCY, list.length) }, worker));
        } catch (e) {
            this.showToast('Auto crop failed: ' + e.message, 4000);
            return;
        } finally {
            this.endTask(key);
            this._autoCropping = false;
        }
        if (entry.items.length) this.pushUndo(entry);
        const notes = [];
        if (noEdge) notes.push(`no print found on ${noEdge}`);
        if (already) notes.push(`${already} already cropped`);
        if (failed) notes.push(`${failed} failed`);
        const msg = (cropped ? `Auto-cropped ${cropped} photo${cropped === 1 ? '' : 's'}` : 'Nothing was cropped') +
            (notes.length ? ` — ${notes.join(', ')}` : '');
        const stillThere = entry.items.length;
        this.showToast(msg, cropped ? 6000 : 4000, null, stillThere ? {
            label: 'Undo',
            run: () => {
                const stack = this._undoStack || [];
                if (stack[stack.length - 1] === entry) this.undo();
                else this.showToast('Something else changed since — use Ctrl+Z');
            }
        } : null, { type: failed && !cropped ? 'error' : 'crop' });
    },

    // Batch Auto crop with Save edits when done: each crop is kept as an
    // edit (nothing is written), so every one can be checked and changed
    // in the crop editor before the edits are saved
    async batchAutoCropKept(list, { feeder = false, scan = false } = {}) {
        this._autoCropping = true;
        const total = list.length;
        const key = 'auto-crop';
        const items = [];
        let done = 0, noEdge = 0, failed = 0;
        const label = () => `Auto crop ${done}/${total}`;
        this.beginTask(key, label());
        try {
            let next = 0;
            const worker = async () => {
                while (next < list.length) {
                    const f = list[next++];
                    try {
                        const ed = await this.detectCrop(f, { feeder, scan });
                        if (!ed) noEdge++;
                        else items.push({ file: f, edit: ed.isIdentity() && !ed.q ? null : ed.snapshot() });
                    } catch (e) {
                        console.error('Auto crop failed for', f.name, e);
                        failed++;
                    }
                    done++;
                    this.updateTask(key, label());
                }
            };
            await Promise.all(Array.from({ length: Math.min(this.AUTO_CROP_CONCURRENCY + 1, list.length) }, worker));
        } finally {
            this.endTask(key);
            this._autoCropping = false;
        }
        const cropped = items.filter(it => it.edit).length;
        if (items.length) Edits.set(items, 'auto crop');
        const notes = [];
        if (noEdge) notes.push(`no print found on ${noEdge}`);
        if (items.length - cropped) notes.push(`${items.length - cropped} already cropped`);
        if (failed) notes.push(`${failed} failed`);
        const msg = (cropped ? `Auto-cropped ${cropped} photo${cropped === 1 ? '' : 's'} — check them, then Save` : 'Nothing was cropped') +
            (notes.length ? ` — ${notes.join(', ')}` : '');
        const entry = (this._undoStack || [])[(this._undoStack || []).length - 1];
        this.showToast(msg, cropped ? 6000 : 4000, null, items.length ? {
            label: 'Undo',
            run: () => {
                const stack = this._undoStack || [];
                if (stack[stack.length - 1] === entry) this.undo();
                else this.showToast('Something else changed since — use Ctrl+Z');
            }
        } : null, { type: failed && !cropped ? 'error' : 'crop' });
    },

    // Auto crop's geometry for one photo, from the photo as it is on disk
    // (not its kept edit): a headless crop editor, or null (no print edge)
    async detectCrop(file, { feeder = false, scan = false } = {}) {
        if (file._rotationQueue) await file._rotationQueue;
        // Detect on the screen-sized preview, as the editor does
        const src = await this.getDisplaySource(file, { raw: true });
        let bmp, W, H;
        if (src.isPreview && src.blob) {
            bmp = await createImageBitmap(src.blob);
            W = src.w;
            H = src.h;
        } else {
            bmp = await createImageBitmap(await file.handle.getFile());
            W = bmp.width;
            H = bmp.height;
        }
        try {
            const det = CropAuto.find(bmp, W, H, { feeder, scan });
            if (!det) return null;
            const ed = CropEditor.headless(W, H);
            ed.fitToPrint(det);
            return ed;
        } finally {
            bmp.close();
        }
    },

    // One photo: 'none' (no print edge), 'same' (nothing to crop) or the
    // undo item { file, backup }
    async autoCropOne(file, backups, { feeder = false, scan = false } = {}) {
        if (file._rotationQueue) await file._rotationQueue;
        // Detect on the screen-sized preview, as the editor does
        const src = await this.getDisplaySource(file, { raw: true });
        let bmp, W, H;
        if (src.isPreview && src.blob) {
            bmp = await createImageBitmap(src.blob);
            W = src.w;
            H = src.h;
        } else {
            bmp = await createImageBitmap(await file.handle.getFile());
            W = bmp.width;
            H = bmp.height;
        }
        let ed;
        try {
            const det = CropAuto.find(bmp, W, H, { feeder, scan });
            if (!det) return 'none';
            ed = CropEditor.headless(W, H);
            ed.fitToPrint(det);
        } finally {
            bmp.close();
        }
        if (ed.isIdentity()) return 'same';

        const { type, quality } = this.getSaveFormat(file.name);
        const fileData = await file.handle.getFile();
        const original = new Uint8Array(await fileData.arrayBuffer());
        const canvas = await ed.renderOutput(fileData, type, original);
        const w = canvas.width, h = canvas.height;
        let blob = await new Promise(r => canvas.toBlob(r, type, quality));
        canvas.width = canvas.height = 0;
        if (!blob) throw new Error('encoding failed');
        blob = await ImageMeta.transplant(original, blob, type, w, h);

        // The original goes to .jeditor/originals before the file changes
        const backupName = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}-${file.name}`;
        const bh = await backups.getFileHandle(backupName, { create: true });
        const bw = await bh.createWritable();
        await bw.write(new Blob([original], { type: fileData.type }));
        await bw.close();

        file.isBusy = true;
        try {
            const writable = await file.handle.createWritable();
            await writable.write(blob);
            await writable.close();
        } finally {
            file.isBusy = false;
        }
        file.pendingRotation = 0;
        file.savingRotation = 0;
        await this.afterFileChanged(file);
        return { file, backup: bh, backupName };
    },

    // Put every photo of a batch back from .jeditor/originals
    async undoAutoCrop(entry) {
        const items = entry.items.slice();
        let failed = 0, next = 0;
        const many = items.length > 1;
        if (many) this.beginTask('undo-auto-crop', `Undoing auto crop of ${items.length} photos…`);
        const worker = async () => {
            while (next < items.length) {
                const it = items[next++];
                try {
                    await this.undoFileEdit({ type: 'bytes', file: it.file, blob: await it.backup.getFile() });
                    try {
                        const backups = await (await FolderCache.root(this, false)).getDirectoryHandle('originals');
                        await backups.removeEntry(it.backupName);
                    } catch (e) { /* Clean Up removes it anyway */ }
                } catch (e) {
                    console.error('Undo failed for', it.file.name, e);
                    failed++;
                }
            }
        };
        try {
            await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker));
        } finally {
            if (many) this.endTask('undo-auto-crop');
        }
        if (failed) throw new Error(`${failed} photo${failed === 1 ? '' : 's'} could not be put back`);
        if (!entry.quiet) this.showToast(`Undid auto crop on ${items.length} photo${items.length === 1 ? '' : 's'}`);
    },

    // ---- Saving edits kept until saved (edits.js) ----
    //
    // Each photo is rendered at full size from its own bytes, as the crop
    // editor saves, and written over the photo; a photo only turned is
    // turned losslessly by the rotation engine. The originals go to
    // originals/ first, as for batch Auto crop, and one Ctrl+Z puts every
    // photo back with its edit kept again. True when all were saved.

    // Save edits is writing kept edits into the photos: a new edit made
    // meanwhile could be dropped or applied twice, so it waits
    editsSaving() {
        if (!this._savingEdits) return false;
        this.showToast('The edits are being saved into the photos. One moment…', 2500);
        return true;
    },

    async saveEdits(list) {
        if (!this.ensureWritable()) return false;
        if (!this.dirHandle) {
            this.showToast('Saving edits needs a folder opened with Open folder');
            return false;
        }
        if (this._savingEdits) {
            this.showToast('The edits are already being saved');
            return false;
        }
        this._savingEdits = true;
        const total = list.length;
        const key = 'save-edits';
        let batchDone;
        const group = { type: 'group', label: 'rotation', items: [], done: new Promise(res => { batchDone = res; }) };
        const entry = { type: 'saved-edits', items: [], group, edits: [] };
        let done = 0, failed = 0, changed = 0;
        const label = () => `Saving edits ${done}/${total}`;
        this.beginTask(key, label());
        try {
            await this.verifyPermission(this.dirHandle, true);
            const root = await FolderCache.root(this, true);
            const backups = await root.getDirectoryHandle('originals', { create: true });
            let next = 0;
            const worker = async () => {
                while (next < list.length) {
                    const f = list[next++];
                    const edit = f._edit;
                    try {
                        if (!edit) continue;
                        const r = await this.saveEditOne(f, edit, backups, group);
                        if (r === 'changed') changed++;
                        else {
                            entry.edits.push({ file: f, edit });
                            if (r !== 'turned') entry.items.push(r);
                        }
                    } catch (e) {
                        console.error('Saving the edit failed for', f.name, e);
                        failed++;
                    }
                    done++;
                    this.updateTask(key, label());
                }
            };
            await Promise.all(Array.from({ length: Math.min(this.AUTO_CROP_CONCURRENCY, list.length) }, worker));
        } catch (e) {
            this.showToast('Saving the edits failed: ' + e.message, 4000);
            return false;
        } finally {
            batchDone();
            this.endTask(key);
            this._savingEdits = false;
        }
        if (entry.edits.length) {
            this.pushUndo(entry);
            Edits.changed([]);
        }
        const saved = entry.edits.length;
        const notes = [];
        if (changed) notes.push(`${changed} changed on disk since the edit, so not saved (open Crop to check them)`);
        if (failed) notes.push(`${failed} failed`);
        this.showToast((saved ? `Saved ${saved} edit${saved === 1 ? '' : 's'} into the photos` : 'Nothing was saved') +
            (notes.length ? ` — ${notes.join(', ')}` : ''), notes.length ? 6000 : 3000, null, saved ? {
            label: 'Undo',
            run: () => {
                const stack = this._undoStack || [];
                if (stack[stack.length - 1] === entry) this.undo();
                else this.showToast('Something else changed since — use Ctrl+Z');
            }
        } : null, { type: failed && !saved ? 'error' : 'crop' });
        return !failed && !changed;
    },

    // 'changed' (the photo isn't the one the edit was made on), 'turned'
    // (only turned: done by the rotation engine) or the undo item
    // { file, backup, backupName }
    async saveEditOne(file, edit, backups, group) {
        if (file._rotationQueue) await file._rotationQueue;
        const fileData = await file.handle.getFile();
        if (edit.size && fileData.size !== edit.size) return 'changed';
        const n = edit.n, eq = (a, b) => Math.abs(a - b) < 1e-6;
        if (!edit.angle && eq(n.x0, -0.5) && eq(n.y0, -0.5) && eq(n.x1, 0.5) && eq(n.y1, 0.5) && !/\.gif$/i.test(file.name)) {
            const q = edit.q % 4;
            delete file._edit;
            file.pendingRotation = q === 3 ? -90 : q * 90;
            file._undoGroup = group;
            try {
                if (!(await this.processRotationQueue(file))) {
                    file._edit = edit;
                    throw new Error('could not turn it');
                }
            } finally {
                if (file._undoGroup === group) file._undoGroup = null;
            }
            this.dropEdited(file);
            await this.afterFileChanged(file);
            return 'turned';
        }

        const { type, quality } = this.getSaveFormat(file.name);
        const original = new Uint8Array(await fileData.arrayBuffer());
        const canvas = await CropEditor.renderSnapshot(fileData, edit, type, original);
        if (!canvas) throw new Error('nothing to save');
        const w = canvas.width, h = canvas.height;
        let blob = await new Promise(r => canvas.toBlob(r, type, quality));
        canvas.width = canvas.height = 0;
        if (!blob) throw new Error('encoding failed');
        blob = await ImageMeta.transplant(original, blob, type, w, h);

        const backupName = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}-${file.name}`;
        const bh = await backups.getFileHandle(backupName, { create: true });
        const bw = await bh.createWritable();
        await bw.write(new Blob([original], { type: fileData.type }));
        await bw.close();

        file.isBusy = true;
        try {
            const writable = await file.handle.createWritable();
            await writable.write(blob);
            await writable.close();
        } finally {
            file.isBusy = false;
        }
        if (file._edit === edit) delete file._edit;
        file.pendingRotation = 0;
        file.savingRotation = 0;
        this.dropEdited(file);
        await this.afterFileChanged(file);
        return { file, backup: bh, backupName };
    },

    // Every photo back as it was, with its edit kept again
    async undoSavedEdits(entry) {
        await entry.group.done;
        let failed = 0;
        try {
            if (entry.items.length) await this.undoAutoCrop({ items: entry.items, quiet: true });
        } catch (e) {
            failed++;
        }
        for (const it of entry.group.items) {
            try { await this.undoFileEdit(it); } catch (e) { console.error('Undo failed for', it.file.name, e); failed++; }
        }
        Edits.restore(entry.edits);
        if (failed) throw new Error('some photos could not be put back');
        const n = entry.edits.length;
        this.showToast(`Put back ${n} photo${n === 1 ? '' : 's'} — the edits are kept again`);
    }
};

// Start
app.init();
