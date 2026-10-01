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
        fileName: document.getElementById('file-name'),
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
        customizePanel: document.getElementById('customize-panel'),
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

        // Show the version on the start screen
        const title = document.getElementById('app-title');
        if (title && typeof APP_VERSION !== 'undefined') {
            title.textContent = 'jEditor ' + APP_VERSION;
        }

        // Drag and Drop
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            document.body.addEventListener(eventName, e => {
                e.preventDefault();
                e.stopPropagation();
            }, false);
        });

        document.body.addEventListener('dragenter', () => {
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
        document.getElementById('btn-batch-rename').addEventListener('click', () => this.batchRename([...this.selection]));
        document.getElementById('btn-export').addEventListener('click', () => this.exportCopies([...this.selection]));
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
        this.elements.gridSizeSlider.addEventListener('input', (e) => {
            const size = e.target.value;
            document.documentElement.style.setProperty('--grid-item-size', `${size}px`);
        });

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

        // Click the filename to rename
        this.elements.fileName.style.cursor = 'pointer';
        this.elements.fileName.title = 'Click to rename';
        this.elements.fileName.addEventListener('click', () => this.promptRename());

        // Ctrl+wheel zooms the grid
        this.elements.gridView.addEventListener('wheel', (e) => {
            if (!e.ctrlKey) return;
            e.preventDefault();
            const slider = this.elements.gridSizeSlider;
            const next = Math.max(80, Math.min(400, parseInt(slider.value, 10) - Math.sign(e.deltaY) * 20));
            slider.value = next;
            document.documentElement.style.setProperty('--grid-item-size', `${next}px`);
        }, { passive: false });

        this.initContextMenu();
        this.initRubberBand();
        this.initShortcutsPanel();

        // Any pointer interaction stops a running slideshow
        document.addEventListener('pointerdown', () => this.stopSlideshow());

        // Header pill: More expander, fullscreen, customize
        this.elements.btnMore.addEventListener('click', () => {
            this.elements.headerControls.classList.toggle('expanded');
        });
        this.elements.btnFullscreen.addEventListener('click', () => this.toggleFullscreen());
        this.elements.btnCustomize.addEventListener('click', () => this.toggleCustomizePanel());
        document.getElementById('btn-shortcuts').addEventListener('click', () => this.toggleShortcutsPanel());
        document.getElementById('btn-dupes').addEventListener('click', () => this.openDupes());
        document.getElementById('cust-shortcuts').addEventListener('click', () => {
            this.toggleCustomizePanel();
            this.toggleShortcutsPanel(true);
        });
        document.getElementById('cust-vertical').addEventListener('change', (e) => {
            this.uiPrefs.vertical = e.target.checked;
            this.saveUiPrefs();
            this.applyUiPrefs();
        });
        document.getElementById('cust-folder-cache').addEventListener('change', (e) => {
            this.uiPrefs.folderCache = e.target.checked;
            this.saveUiPrefs();
        });
        document.getElementById('cust-cleanup').addEventListener('click', () => {
            this.toggleCustomizePanel();
            this.cleanUpFolder();
        });
        document.getElementById('cust-scale').addEventListener('input', (e) => {
            this.uiPrefs.scale = parseFloat(e.target.value);
            this.saveUiPrefs();
            this.applyUiPrefs();
        });
        document.getElementById('cust-reset').addEventListener('click', () => {
            this.uiPrefs = this.defaultUiPrefs();
            this.saveUiPrefs();
            this.applyUiPrefs();
            this.renderCustomizePanel();
        });

        this.initStripResize();

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

            // Reset state
            this.cleanupURLs();
            this.files = [];
            this.dirHandle = dirHandle;
            this.readOnlyMode = false; // Modern API supports writing

            this.beginTask('scan', 'Scanning folder…');
            this.elements.dropZone.classList.add('hidden');

            await this.scanDirectory(dirHandle);

            await this.finalizeLoad();

        } catch (err) {
            if (err.name === 'AbortError') {
                // User cancelled the picker
                this.log('Folder selection cancelled');
                return;
            }
            console.error('Browse folder error:', err);
            alert('Error loading folder: ' + err.message);
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

    // ---- UI customization ----
    //
    // Every header control can be shown in the pill, tucked into the "More"
    // section, or hidden entirely; the order is drag-reorderable in the
    // Customize panel. Orientation (horizontal/vertical), UI scale, film
    // strip height and thumbnail fit are all preferences too. Everything
    // persists in localStorage under 'jeditor.ui'.

    HC_LABELS: {
        info: 'File Info',
        view: 'Toggle View',
        refresh: 'Refresh Folder',
        crop: 'Crop',
        fit: 'Thumbnail Fit',
        strip: 'Film Strip',
        fullscreen: 'Fullscreen',
        dupes: 'Find Duplicates (WIP)',
        keys: 'Keyboard Shortcuts',
        customize: 'Customize'
    },

    defaultUiPrefs() {
        return {
            order: ['info', 'view', 'refresh', 'crop', 'fit', 'strip', 'fullscreen', 'dupes', 'keys', 'customize'],
            placement: { // 'main' | 'more' | 'hidden'
                info: 'main', view: 'main', refresh: 'main', crop: 'main',
                fit: 'more', strip: 'more', fullscreen: 'more', dupes: 'more', keys: 'more', customize: 'more'
            },
            vertical: false,
            scale: 1,
            stripHeight: 80,
            thumbContain: true, // fit whole image in tiles by default
            folderCache: true // keep thumbnails / duplicate data in the folder's .jeditor
        };
    },

    loadUiPrefs() {
        this.uiPrefs = this.defaultUiPrefs();
        try {
            const saved = JSON.parse(localStorage.getItem('jeditor.ui') || 'null');
            if (saved) {
                if (Array.isArray(saved.order)) {
                    // keep unknown-key safety: only accept known keys, append missing
                    const known = this.uiPrefs.order;
                    this.uiPrefs.order = saved.order.filter(k => known.includes(k))
                        .concat(known.filter(k => !saved.order.includes(k)));
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
            }
        } catch (e) { /* corrupted prefs → defaults */ }
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
        const known = this.defaultUiPrefs().order;
        p.order = p.order.filter(k => known.includes(k)).concat(known.filter(k => !p.order.includes(k)));

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
    },

    toggleCustomizePanel() {
        const panel = this.elements.customizePanel;
        const open = panel.classList.contains('hidden');
        panel.classList.toggle('hidden', !open);
        if (open) this.renderCustomizePanel();
    },

    renderCustomizePanel() {
        const list = this.elements.customizeList;
        list.innerHTML = '';
        document.getElementById('cust-vertical').checked = !!this.uiPrefs.vertical;
        document.getElementById('cust-folder-cache').checked = this.uiPrefs.folderCache !== false;
        document.getElementById('cust-scale').value = this.uiPrefs.scale;

        this.uiPrefs.order.forEach(key => {
            const li = document.createElement('li');
            li.draggable = true;
            li.dataset.key = key;

            const grip = document.createElement('span');
            grip.className = 'cust-grip';
            grip.textContent = '≡';
            const name = document.createElement('span');
            name.className = 'cust-name';
            name.textContent = this.HC_LABELS[key] || key;
            const sel = document.createElement('select');
            [['main', 'Shown'], ['more', 'In More'], ['hidden', 'Hidden']].forEach(([v, l]) => {
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

            li.addEventListener('dragstart', (e) => {
                this._dragKey = key;
                e.dataTransfer.effectAllowed = 'move';
            });
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

    toggleThumbnailStrip() {
        const strip = this.elements.thumbnailStrip;
        const show = strip.classList.contains('hidden');
        strip.classList.toggle('hidden', !show);
        if (this.elements.stripResize) this.elements.stripResize.classList.toggle('hidden', !show);
        this.elements.btnToggleStrip.style.opacity = show ? '1' : '0.5';
        this.elements.btnToggleStrip.blur(); // Release focus to restore keyboard shortcuts
    },

    handleZoom(e) {
        if (this.viewMode !== 'single') return;
        if (this.cropState.active) return; // Disable zoom while cropping
        e.preventDefault();

        const delta = -Math.sign(e.deltaY) * 0.1;
        this.zoom += delta;
        if (this.zoom < 0.1) this.zoom = 0.1;
        if (this.zoom > 8) this.zoom = 8;

        // Update cursor based on zoom level
        this.elements.imageContainer.style.cursor = this.zoom > 1 ? 'grab' : 'default';

        this.updateImageTransform();
        if (this.zoom > 1) this.ensureFullRes();
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

        let target = 1;
        if (Math.abs(this.zoom - 1) < 0.01) {
            const f = this.currentFile;
            const fullW = f._dims ? f._dims.w
                : (this._displayFile === f && this._displayKind === 'full' ? img.naturalWidth : 0);
            const fit = this.currentFitScale();
            const oneToOne = fullW ? fullW / (img.offsetWidth * fit) : 0;
            target = Math.max(2, Math.min(8, oneToOne || 2.5));
        }

        if (target === 1) {
            this.resetPan();
        } else {
            // Keep the clicked point under the pointer. Scaling is about the
            // image's centre, so rotation doesn't change the maths.
            const rect = img.getBoundingClientRect();
            const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
            const dx = Math.max(-rect.width / 2, Math.min(rect.width / 2, e.clientX - cx));
            const dy = Math.max(-rect.height / 2, Math.min(rect.height / 2, e.clientY - cy));
            const k = target / this.zoom;
            this.panX += dx * (1 - k);
            this.panY += dy * (1 - k);
            this.zoom = target;
        }

        // A gentler transition than the wheel's for the big jump
        img.classList.add('zoom-animate');
        clearTimeout(this._zoomAnimTimer);
        this._zoomAnimTimer = setTimeout(() => img.classList.remove('zoom-animate'), 260);

        this.elements.imageContainer.style.cursor = this.zoom > 1 ? 'grab' : 'default';
        this.updateImageTransform();
        if (this.zoom > 1) this.ensureFullRes();
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
            alert('Error loading: ' + err.message);
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

            if (this.files.length > 0) {
                this.showToast(`Loaded ${this.files.length} images.`, 3000);
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
                this.setView(this.viewMode);

                // Warm the entire preview cache in the background so grid
                // scrolling only ever hits already-generated thumbnails
                this.precacheThumbnails();
            } else {
                alert('No images found.');
                this.elements.dropZone.classList.remove('hidden');
            }
        } catch (err) {
            console.error('Error finalizing load:', err);
            alert(`Error: ${err.message || err}`);
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

    async scanDirectory(dirHandle, prefix = '', seen = null) {
        // Paths already loaded (so Refresh only adds new photos). A Set keeps
        // this O(1) per file — the old array scan was quadratic.
        if (!seen) seen = new Set(this.files.map(f => f.relPath || f.name));
        try {
            this.updateTask('scan', 'Scanning folder…');
            const pending = [];
            const subdirs = [];
            for await (const entry of dirHandle.values()) {
                if (entry.kind === 'file' && this.isImage(entry.name) && !entry.name.startsWith('.jeditor-')) {
                    const relPath = prefix + entry.name;
                    if (!seen.has(relPath)) {
                        seen.add(relPath);
                        pending.push({ entry, relPath });
                    }
                } else if (entry.kind === 'directory') {
                    // Skip our own working folders
                    if (entry.name === FolderCache.DIR || entry.name === FolderCache.LEGACY_TRASH || entry.name === 'jEditor Export') continue;
                    subdirs.push(entry);
                }
            }
            // Read size/date in parallel batches instead of one at a time
            const BATCH = 32;
            for (let i = 0; i < pending.length; i += BATCH) {
                const batch = pending.slice(i, i + BATCH);
                const datas = await Promise.all(batch.map(p => p.entry.getFile().catch(() => null)));
                batch.forEach(({ entry, relPath }, j) => {
                    const fileData = datas[j];
                    if (!fileData) return;
                    this.files.push({
                        name: entry.name,
                        relPath,
                        parentDir: dirHandle,
                        handle: entry,
                        size: fileData.size,
                        lastModified: fileData.lastModified
                    });
                });
                this.updateTask('scan', `Scanning folder… ${this.files.length} images`);
            }
            for (const sub of subdirs) {
                await this.scanDirectory(sub, prefix + sub.name + '/', seen);
            }
        } catch (e) {
            console.warn('Skipping subdirectory due to error:', e);
        }
    },

    async refreshFolder() {
        if (!this.dirHandle) return;
        this.log('Manual Refresh Started');
        this.beginTask('scan', 'Scanning for new photos…');

        try {
            const oldLength = this.files.length;
            await this.scanDirectory(this.dirHandle);

            if (this.files.length > oldLength) {
                this.sortFiles();
                this.precacheThumbnails();
                this.showToast(`Found ${this.files.length - oldLength} new photos`, 3000);
            } else {
                this.showToast('Folder is up to date', 2000);
            }
        } catch (e) {
            console.error('Refresh failed:', e);
            this.showToast('Refresh failed');
        } finally {
            this.endTask('scan');
        }
    },

    // Legacy drag-and-drop gives read-only files. Say so up front instead
    // of letting an edit run and fail at the save.
    ensureWritable() {
        if (!this.readOnlyMode) return true;
        this.showToast('These photos were opened read-only — use Open Folder to edit and save', 4000);
        return false;
    },

    isImage(name) {
        return /\.(jpg|jpeg|png|webp|gif)$/i.test(name);
    },

    getCurrentIndex() {
        return this.files.indexOf(this.currentFile);
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

    // Subtle always-on chip in the bottom-left with location + file name
    updateStatusBar() {
        const el = this.elements.statusBar;
        if (!el) return;
        if (!this.currentFile) {
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
        return `${(n / (1024 * 1024)).toFixed(2)} MB`;
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
                    if (m) result.dateTaken = new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
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
        file._exif = null;
        if (/\.jpe?g$/i.test(file.name)) {
            try {
                const fileData = await file.handle.getFile();
                const head = await fileData.slice(0, 256 * 1024).arrayBuffer();
                file._exif = this.readJpegExifInfo(head);
            } catch (e) { /* leave null */ }
        }
        return file._exif;
    },

    toggleInfoPanel(forceOpen = null) {
        const panel = this.elements.infoPanel;
        if (!panel) return;
        const open = forceOpen !== null ? forceOpen : panel.classList.contains('hidden');
        panel.classList.toggle('hidden', !open);
        this._infoOpen = open;
        if (open) this.fillInfoPanel(this.currentFile);
    },

    async fillInfoPanel(file) {
        const list = this.elements.infoList;
        if (!list || !file) return;
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

    sortFiles(render = true) {
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
                const cmp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
                return mode.endsWith('asc') ? cmp : -cmp;
            } else {
                return mode.endsWith('asc') ? valA - valB : valB - valA;
            }
        });

        // Selection and currentFile hold file objects, so nothing to remap —
        // the same photos stay selected/active regardless of order.
        if (render) {
            this.renderThumbnails();
            this.renderGrid();
            this.updateActiveThumbnail();
            this.updateSelectionUI();
            const idx = this.getCurrentIndex();
            if (idx !== -1) this.elements.fileCount.textContent = `${idx + 1} / ${this.files.length}`;
        }
    },

    cleanupURLs() {
        // Drop queued thumbnail work for the folder being replaced
        if (this._thumbQueue) this._thumbQueue.length = 0;

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

    analyzeImageBrightness(img) {
        const vals = this.measureBrightness(img);
        if (vals) this.applyGlass(vals);
        return vals;
    },

    measureBrightness(img) {
        if (!img || !img.width || !img.height) return null;

        // Sample the image at 50x50 and measure three zones: the whole image
        // (drives the global theme) plus the top and bottom bands, which sit
        // behind the header glass and the control glass respectively. Each
        // glass region adapts to what is actually behind it.
        const SIZE = 50;
        const BAND = 13; // ~top/bottom quarter of the image

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = SIZE;
        canvas.height = SIZE;
        ctx.drawImage(img, 0, 0, SIZE, SIZE);

        try {
            const data = ctx.getImageData(0, 0, SIZE, SIZE).data;
            let total = 0, top = 0, bottom = 0;

            for (let y = 0; y < SIZE; y++) {
                let rowSum = 0;
                for (let x = 0; x < SIZE; x++) {
                    const i = (y * SIZE + x) * 4;
                    // Perceived brightness
                    rowSum += (data[i] * 0.299) + (data[i + 1] * 0.587) + (data[i + 2] * 0.114);
                }
                total += rowSum;
                if (y < BAND) top += rowSum;
                if (y >= SIZE - BAND) bottom += rowSum;
            }

            return {
                total: total / (SIZE * SIZE),
                top: top / (BAND * SIZE),
                bottom: bottom / (BAND * SIZE)
            };
        } catch (e) {
            console.warn('Cannot analyze image brightness (CORS or error)', e);
            return null;
        }
    },

    applyGlass(vals) {
        // Hysteresis: don't flip a region's theme on borderline photos —
        // it must cross clearly into the other zone to switch.
        const body = document.body;
        const setWithHysteresis = (cls, value) => {
            if (value > 150) body.classList.add(cls);
            else if (value < 120) body.classList.remove(cls);
            // 120–150: keep whatever it was
        };
        setWithHysteresis('light-theme', vals.total);
        setWithHysteresis('glass-light-top', vals.top);
        setWithHysteresis('glass-light-bottom', vals.bottom);
    },



    renderThumbnails() {
        // Only for single view footer
        this.elements.thumbnailStrip.innerHTML = '';
        const frag = document.createDocumentFragment();

        // Optimally, we don't load all 1000s, but for the strip we can load visible ones.
        // For simple implementation, we can just create divs and lazy load their bg image.
        // Actually, let's reuse the lazy loader logic if possible, or just load them if < 50, otherwise placeholders.
        // User complained about simple color blocks.

        // Let's use IntersectionObserver for the strip too.
        const stripObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const div = entry.target;
                    // Load small thumbnail as bg image
                    this.loadStripThumbnail(div._file, div);
                    stripObserver.unobserve(div);
                }
            });
        }, { root: this.elements.thumbnailStrip, rootMargin: '0px 400px' });

        this.files.forEach((file) => {
            const div = document.createElement('div');
            div.className = 'thumb-item';
            div._file = file;
            file._stripEl = div;
            // Placeholder color still useful while loading
            div.style.backgroundColor = '#222';

            div.onclick = () => this.openSingle(file);
            frag.appendChild(div);
            stripObserver.observe(div);
        });
        this.elements.thumbnailStrip.appendChild(frag);
        this._activeStripEl = null;
        this.updateActiveThumbnail();
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

    // Highlight the current photo in the film strip and centre it. Touches
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

    // Grid View with Lazy Loading
    renderGrid() {
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

        // Chunked render: big folders paint the first screenfuls immediately
        // and append the rest during idle time.
        const CHUNK = 500;
        const token = (this._gridRenderToken = (this._gridRenderToken || 0) + 1);
        const renderChunk = (start) => {
            if (token !== this._gridRenderToken) return; // superseded re-render
            const frag = document.createDocumentFragment();
            const end = Math.min(start + CHUNK, this.files.length);
            for (let i = start; i < end; i++) {
                frag.appendChild(this.makeGridTile(this.files[i], observer));
            }
            this.elements.gridView.appendChild(frag);
            if (end < this.files.length) {
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
            const src = `self.onmessage = async (e) => {
                const { id, file, targetWidth, type, edge } = e.data;
                try {
                    if (edge) {
                        const full = await createImageBitmap(file);
                        const w = full.width, h = full.height;
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
                    const bitmap = await createImageBitmap(file, { resizeWidth: targetWidth, resizeQuality: 'medium' });
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
                console.error('Thumbnail error:', e);
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
        const fileData = await fileEntry.handle.getFile();

        let blob;
        if (fileData.size <= this.THUMB_FAST_PATH_BYTES) {
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

        if (fileEntry.thumbnailUrl) URL.revokeObjectURL(fileEntry.thumbnailUrl);
        fileEntry.thumbnailUrl = URL.createObjectURL(blob);
        fileEntry.thumbLag = (fileEntry._savedRotationTotal || 0) - savedAtRead;
        fileEntry._thumbPromise = null;
        fileEntry._thumbStale = false;
        this.deliverThumbnail(fileEntry);
    },

    deliverThumbnail(fileEntry) {
        const url = fileEntry.thumbnailUrl;
        (fileEntry._thumbWaiters || []).forEach(img => {
            img.decoding = 'async';
            img.src = url;
        });
        fileEntry._thumbWaiters = [];
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

        await this.ensureThumbnail(fileEntry, { urgent: true, force }).catch(() => { });
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
        const msg = 'Remove jEditor\'s data from this folder?\n\n' +
            (inTrash ? `• Empties the trash: ${inTrash} deleted photo${inTrash === 1 ? '' : 's'} will be gone for good.\n` : '') +
            '• Removes cached thumbnails and duplicate data (they\'re rebuilt when needed).\n\nYour photos are not touched.';
        if (!window.confirm(msg)) return;
        this.beginTask('cleanup', 'Cleaning up folder…');
        try {
            await FolderCache.cleanUp(this);
            // Trash undo steps can't be undone any more
            this._undoStack = (this._undoStack || []).filter(e => e.type !== 'trash');
            this.showToast(inTrash ? `Folder cleaned up — trash emptied (${inTrash})` : 'Folder cleaned up', 3000);
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
        let done = 0;
        missing.forEach(file => {
            this.ensureThumbnail(file, { urgent: false })
                .catch(() => { })
                .finally(() => {
                    done++;
                    if (!showProgress) return;
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
        if (e.ctrlKey || e.metaKey) {
            this.toggleSelection(file);
        } else if (e.shiftKey) {
            // Range selection: from the current photo to the clicked one
            const idx = this.files.indexOf(file);
            const anchor = this.getCurrentIndex();
            const start = Math.min(anchor === -1 ? idx : anchor, idx);
            const end = Math.max(anchor === -1 ? idx : anchor, idx);
            this.selection.clear();
            for (let i = start; i <= end; i++) this.selection.add(this.files[i]);
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
        this.viewMode = mode;
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
            iconGrid.classList.add('hidden');
            iconSingle.classList.remove('hidden');

            // Ensure selection UI is correct
            if (this.selection.size === 0 && this.currentFile) {
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
            this.elements.thumbnailStrip.classList.remove('hidden');
            if (this.elements.stripResize) this.elements.stripResize.classList.remove('hidden');
            this.elements.gridControls.classList.add('hidden');
            iconGrid.classList.remove('hidden');
            iconSingle.classList.add('hidden');
            this.selection.clear(); // Clear selection on enter single? Or keep?
            // Usually keeping is confusing if you just want to flip. Let's keep but only active is `currentFile`.
            this.elements.selectionBar.classList.add('hidden');

            if (this.currentFile) this.loadFile(this.currentFile);
        }
    },

    loadIndex(index) {
        if (this.files.length === 0) return;
        if (index < 0) index = this.files.length - 1;
        if (index >= this.files.length) index = 0;
        return this.loadFile(this.files[index]);
    },

    // Make `file` the current photo: header, counter, status chip, info
    // panel and film strip — everything except the big image.
    setCurrent(file) {
        this.currentFile = file;
        this.elements.fileName.textContent = file.name;
        this.elements.fileCount.textContent = `${this.files.indexOf(file) + 1} / ${this.files.length}`;
        this.updateStatusBar();
        if (this._infoOpen) this.fillInfoPanel(file);
        this.updateActiveThumbnail();
    },

    // ---- Single-view display pipeline ----
    //
    // Navigating must never show a blank frame. The photos either side of
    // the current one are decoded ahead of time into detached <img>
    // elements, so stepping to them is a DOM swap with no decode at all. A
    // photo that isn't ready yet shows its cached thumbnail immediately and
    // upgrades to full resolution the moment its decode finishes.

    DECODE_RADIUS: 1, // neighbours kept decoded each side (full-res scans are large)

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
    getDisplaySource(file) {
        if (file._sourcePromise) return file._sourcePromise;
        const p = (async () => {
            while (file.isBusy) await new Promise(r => setTimeout(r, 30));
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
        const n = this.files.length;
        const i = this.files.indexOf(file);
        if (i === -1 || n < 3) return;
        const dir = this._navDir || 1;
        for (let d = 2; d <= 4; d++) {
            const f = this.files[(i + d * dir + n * 4) % n];
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
                    this.applyGlassFor(file, ph);
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
        this.applyGlassFor(file, el);
        this.warmPreviews(file);
    },

    // Adaptive glass, sampled once per photo and reused on revisits.
    // Sampling a full-size image costs tens of milliseconds, so it uses the
    // photo's 320px thumbnail when that is loaded, and otherwise waits until
    // the new photo has painted.
    applyGlassFor(file, img) {
        if (file._glass) {
            this.applyGlass(file._glass);
            return;
        }
        const thumb = file._stripEl && file._stripEl.querySelector('img');
        if (thumb && thumb.complete && thumb.naturalWidth && thumb.src.startsWith('blob:')) {
            file._glass = this.analyzeImageBrightness(thumb);
            return;
        }
        if (!img) return;
        setTimeout(() => {
            if (file._glass || !img.naturalWidth) return;
            file._glass = this.measureBrightness(img);
            if (file._glass && this._displayFile === file) this.applyGlass(file._glass);
        }, 0);
    },

    // Decode the photos either side (wrapping, like navigation does) and
    // release decoded images that fell out of that window.
    preloadNeighbours(file) {
        const n = this.files.length;
        const i = this.files.indexOf(file);
        if (i === -1 || n < 2) return;
        const keep = new Set([file]);
        for (let d = 1; d <= this.DECODE_RADIUS; d++) {
            keep.add(this.files[(i + d) % n]);
            keep.add(this.files[(i - d + n) % n]);
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
        const cur = this.getCurrentIndex();
        const windowSizeFull = 4; // in-memory copies of originals (see getOriginalSource)


        this.files.forEach((f, i) => {
            if (f === this.currentFile) return;
            const dist = Math.abs(i - cur);
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
        });
    },

    navigate(direction) {
        if (this.files.length === 0) return;
        this._navDir = direction < 0 ? -1 : 1;
        const n = this.files.length;
        let newIndex = this.getCurrentIndex() + direction;
        if (Math.abs(direction) > 1) {
            // Row jumps in the grid stop at the edges instead of wrapping
            newIndex = Math.max(0, Math.min(n - 1, newIndex));
        } else {
            newIndex = (newIndex + n) % n;
        }
        this.goTo(this.files[newIndex]);
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

    // Stacking toasts: each message gets its own pill; concurrent operations
    // stack vertically instead of overwriting each other. Passing the same
    // `key` updates an existing toast in place (progress → done), and
    // duration 0 keeps a toast up until it is updated with a duration.
    showToast(message, duration = 3000, key = null) {
        let stack = document.getElementById('toast-stack');
        if (!stack) {
            stack = document.createElement('div');
            stack.id = 'toast-stack';
            document.body.appendChild(stack);
        }

        let toast = key ? stack.querySelector(`[data-key="${CSS.escape(key)}"]`) : null;
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'toast';
            if (key) toast.dataset.key = key;
            stack.appendChild(toast);
            // Let layout settle so the enter transition plays
            requestAnimationFrame(() => toast.classList.add('visible'));
        }
        toast.textContent = message;

        if (toast._timer) clearTimeout(toast._timer);
        if (duration > 0) {
            toast._timer = setTimeout(() => {
                toast.classList.remove('visible');
                setTimeout(() => toast.remove(), 300);
            }, duration);
        }
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
        ['edit.crop', 'global', 'Edit', 'Crop & straighten', ['C']],
        ['edit.rename', 'global', 'Edit', 'Rename (the selection in grid view)', ['F2']],
        ['edit.trash', 'global', 'Edit', 'Move to trash', ['Delete']],
        ['edit.undo', 'global', 'Edit', 'Undo', ['Ctrl+Z']],
        ['edit.selectAll', 'global', 'Edit', 'Select all (grid)', ['Ctrl+A']],
        ['view.toggle', 'global', 'View', 'Toggle grid / single view', ['Space']],
        ['view.grid', 'global', 'View', 'Grid view', ['G']],
        ['view.single', 'global', 'View', 'Single view', ['S']],
        ['view.open', 'global', 'View', 'Open photo (grid)', ['Enter']],
        ['view.back', 'global', 'View', 'Back to grid / clear selection', ['Escape']],
        ['view.zoomIn', 'global', 'View', 'Zoom in', ['+', '=']],
        ['view.zoomOut', 'global', 'View', 'Zoom out', ['-']],
        ['view.zoomFit', 'global', 'View', 'Zoom to fit', ['0']],
        ['view.info', 'global', 'View', 'File info', ['I']],
        ['view.fullscreen', 'global', 'View', 'Fullscreen', ['F']],
        ['view.slideshow', 'global', 'View', 'Slideshow', []],
        ['app.dupes', 'global', 'App', 'Find duplicates (WIP)', ['D']],
        ['app.refresh', 'global', 'App', 'Rescan folder', ['R']],
        ['app.shortcuts', 'global', 'App', 'Keyboard shortcuts', ['?']],
        ['app.debug', 'global', 'App', 'Debug console', ['Ctrl+Shift+D']],
        ['crop.save', 'crop', 'Crop & Straighten', 'Save', ['Enter']],
        ['crop.saveNext', 'crop', 'Crop & Straighten', 'Save, then crop next photo', ['Shift+Enter']],
        ['crop.cancel', 'crop', 'Crop & Straighten', 'Cancel', ['Escape']],
        ['crop.rotateLeft', 'crop', 'Crop & Straighten', 'Rotate left 90°', ['[']],
        ['crop.rotateRight', 'crop', 'Crop & Straighten', 'Rotate right 90°', [']']],
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

    // Handlers return false when the key doesn't apply right now, which
    // lets the browser's default behaviour through.
    keyHandlers() {
        const grid = () => this.viewMode === 'grid';
        const ed = CropEditor;
        return {
            'nav.prev': () => this.navigate(-1),
            'nav.next': () => this.navigate(1),
            'nav.up': () => grid() ? this.navigate(-this.getGridColumnCount()) : false,
            'nav.down': () => grid() ? this.navigate(this.getGridColumnCount()) : false,
            'nav.first': () => this.goTo(this.files[0]),
            'nav.last': () => this.goTo(this.files[this.files.length - 1]),
            'edit.rotateLeft': () => grid() ? this.rotateBulk(-90) : this.rotateCurrent(-90),
            'edit.rotateRight': () => grid() ? this.rotateBulk(90) : this.rotateCurrent(90),
            'edit.crop': () => this.enterCrop(),
            'edit.rename': () => this.openRename(grid() && this.selection.size ? [...this.selection] : [this.currentFile]),
            'edit.trash': () => this.moveToTrash(grid() && this.selection.size
                ? [...this.selection] : [this.currentFile]),
            'edit.undo': () => this.undo(),
            'edit.selectAll': () => {
                if (!grid()) return false;
                this.selection = new Set(this.files);
                this.updateSelectionUI();
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
            'app.shortcuts': () => this.toggleShortcutsPanel(),
            'app.debug': () => this.toggleDebugConsole(),
            'crop.save': () => this.saveCrop(),
            'crop.saveNext': () => this.saveCrop({ next: true }),
            'crop.cancel': () => this.cancelCrop(),
            'crop.rotateLeft': () => ed.rotateQuarter(-1),
            'crop.rotateRight': () => ed.rotateQuarter(1),
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

    // Normalised combo for a keydown: 'Ctrl+Shift+D', 'Shift+ArrowLeft', 'C',
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

    loadKeyBindings() {
        this.keyBindings = {};
        this.KEY_ACTIONS.forEach(([id, , , , keys]) => { this.keyBindings[id] = [...keys]; });
        try {
            const saved = JSON.parse(localStorage.getItem('jeditor.keys') || 'null');
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
        this.KEY_ACTIONS.forEach(([id, , , , keys]) => {
            if (this.keyBindings[id].join('\n') !== keys.join('\n')) changed[id] = this.keyBindings[id];
        });
        try { localStorage.setItem('jeditor.keys', JSON.stringify(changed)); } catch (e) { /* private mode */ }
        this.buildKeyMaps();
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
        this.KEY_ACTIONS.forEach(([aid, , , , keys]) => {
            if (!id || aid === id) this.keyBindings[aid] = [...keys];
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

        // The rename tool handles its own keys
        if (Renamer.isOpen) return;

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

        const context = this.cropState.active ? 'crop' : (Dupes.isOpen ? 'dupes' : 'global');
        // Duplicates view: 1–9 mark/unmark the photo with that number
        if (context === 'dupes' && /^[1-9]$/.test(combo)) {
            e.preventDefault();
            Dupes.toggle(parseInt(combo, 10) - 1);
            return;
        }
        const id = this._keyMaps[context].get(combo);
        if (!id) return;
        // Only the shortcut list and debug console work from the start screen
        const onStart = this.elements.mainInterface.classList.contains('hidden');
        if (onStart && context === 'global' && id !== 'app.shortcuts' && id !== 'app.debug') return;
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
        const show = debugEl.style.display === 'none';
        debugEl.style.display = show ? 'block' : 'none';
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
        if (!el || !consoleEl || consoleEl.style.display === 'none') {
            clearInterval(this._perfTimer);
            return;
        }
        el.textContent = this.perfSnapshot().join('\n');
    },

    zoomBy(factor) {
        if (this.viewMode !== 'single' || this.cropState.active) return false;
        if (factor === 0) {
            this.resetPan();
        } else {
            this.zoom = Math.max(0.1, Math.min(8, this.zoom * factor));
            if (this.zoom <= 1) { this.panX = 0; this.panY = 0; }
        }
        this.elements.imageContainer.style.cursor = this.zoom > 1 ? 'grab' : 'default';
        this.updateImageTransform();
        if (this.zoom > 1) this.ensureFullRes();
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
            actions.forEach(([id, , , label, defaults]) => {
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
        // Click on the backdrop closes
        panel.addEventListener('mousedown', (e) => { if (e.target === panel) this.toggleShortcutsPanel(false); });
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
                ok = (await this.processRotationQueue(file)) && ok;
                done++;
                if (filesToRotate.length >= 50 && done % 25 === 0) {
                    this.updateTask(taskKey, `Rotating ${done}/${filesToRotate.length}…`);
                }
            }
        };
        await Promise.all(Array.from({ length: Math.min(4, filesToRotate.length) }, worker));

        this.endTask(taskKey);
        this.showToast(ok ? `Rotated ${label} ${deg > 0 ? 'right' : 'left'}` : 'Some photos failed to rotate', 2000);
        this.log('Bulk rotation finished');
    },

    rotateImage(fileEntry, deg) {
        if (!fileEntry) return Promise.resolve(false);
        if (!this.ensureWritable()) return Promise.resolve(false);

        if (/\.gif$/i.test(fileEntry.name)) {
            this.showToast('GIF rotation is not supported (animation would be lost)');
            return Promise.resolve(false);
        }

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
                const startUndo = (entry) => {
                    if (undoEntry || fileEntry._undoing) return;
                    undoEntry = entry;
                    this.pushUndo(entry);
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
        }
    },
    // ---- Undo ----
    UNDO_LIMIT: 50,
    UNDO_MAX_BYTES: 256 * 1024 * 1024, // file copies kept for undo (crops, re-encodes)

    pushUndo(entry) {
        if (!this._undoStack) this._undoStack = [];
        const stack = this._undoStack;
        stack.push(entry);
        while (stack.length > this.UNDO_LIMIT ||
            (stack.length > 1 && this.undoBytes() > this.UNDO_MAX_BYTES)) stack.shift();
    },

    undoBytes() {
        return (this._undoStack || []).reduce((n, e) => n + (e.blob ? e.blob.size : 0), 0);
    },

    async undo() {
        const entry = (this._undoStack || []).pop();
        if (!entry) {
            this.showToast('Nothing to undo');
            return;
        }
        try {
            if (entry.type === 'bytes') {
                const f = entry.file;
                if (f._rotationQueue) await f._rotationQueue;
                f.pendingRotation = 0;
                f.savingRotation = 0;
                const writable = await f.handle.createWritable();
                await writable.write(entry.blob);
                await writable.close();
                await this.afterFileChanged(f);
                this.showToast(`Undid ${entry.label} on ${f.name}`);
            } else if (entry.type === 'rotate') {
                const f = entry.file;
                if (f._rotationQueue) await f._rotationQueue;
                f._undoing = true; // the reverse rotation isn't itself undoable
                try {
                    f.pendingRotation = (f.pendingRotation || 0) - entry.deg;
                    this.applyPreviewRotation(f);
                    if (!(await this.processRotationQueue(f))) throw new Error('could not rotate back');
                } finally {
                    f._undoing = false;
                }
                this.showToast(`Undid rotation on ${f.name}`);
            } else if (entry.type === 'rename') {
                await this.renameFile(entry.file, entry.oldName, { skipUndo: true });
                this.showToast('Rename undone');
            } else if (entry.type === 'batch-rename') {
                const ok = await this.renameMany(entry.items.map(it => ({ file: it.file, newName: it.oldName })), { skipUndo: true });
                if (!ok) throw new Error('could not restore the old names');
                this.showToast(`Rename undone (${entry.items.length} file${entry.items.length === 1 ? '' : 's'})`);
            } else if (entry.type === 'trash') {
                for (const it of entry.items) await this.restoreFromTrash(it);
                this.sortFiles();
                this.showToast(`Restored ${entry.items.length} photo${entry.items.length > 1 ? 's' : ''}`);
            }
        } catch (e) {
            console.error('Undo failed:', e);
            this.showToast('Undo failed: ' + e.message);
        }
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
        f.dateTaken = undefined;
        f._dims = undefined;
        f._glass = undefined;
        f._fp = undefined;
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

    async moveToTrash(files) {
        const list = files.filter(Boolean);
        if (!list.length) return;
        if (!this.ensureWritable()) return;
        if (!this.dirHandle) {
            this.showToast('Deleting requires opening a folder (not loose files)');
            return;
        }
        const undoItems = [];
        try {
            const trashDir = await FolderCache.trashDir(this);
            for (const f of list) {
                try {
                    if (f._rotationQueue) await f._rotationQueue;
                    const data = await f.handle.getFile();
                    let trashName = f.name;
                    try {
                        await trashDir.getFileHandle(trashName);
                        trashName = `${Date.now()}_${f.name}`; // avoid collision
                    } catch (e) { /* name is free */ }
                    const th = await trashDir.getFileHandle(trashName, { create: true });
                    const w = await th.createWritable();
                    await w.write(data);
                    await w.close();
                    await (f.parentDir || this.dirHandle).removeEntry(f.name);
                    undoItems.push({ file: f, trashDir, trashName });
                    this.removeFileFromApp(f);
                } catch (e) {
                    console.error('Trash failed for', f.name, e);
                    this.showToast(`Couldn't delete ${f.name}`);
                }
            }
        } catch (e) {
            console.error('Trash unavailable:', e);
            this.showToast('Delete failed: ' + e.message);
        }
        if (undoItems.length) {
            this.pushUndo({ type: 'trash', items: undoItems });
            this.showToast(`Moved ${undoItems.length} to the trash (.jeditor/trash) — Ctrl+Z to restore`, 4000);
        }
    },

    removeFileFromApp(f) {
        const idx = this.files.indexOf(f);
        if (idx === -1) return;
        const wasCurrent = this.currentFile === f;
        this.files.splice(idx, 1);
        this.selection.delete(f);
        if (f._gridEl) f._gridEl.remove();
        if (f._stripEl) f._stripEl.remove();

        if (this.files.length === 0) {
            this.currentFile = null;
            this.updateStatusBar();
            this.elements.mainInterface.classList.add('hidden');
            this.elements.dropZone.classList.remove('hidden');
        } else if (wasCurrent) {
            const next = this.files[Math.min(idx, this.files.length - 1)];
            if (this.viewMode === 'single') {
                this.loadFile(next);
            } else {
                this.currentFile = next;
                this.updateStatusBar();
            }
        }
        this.updateSelectionUI();
        const ci = this.getCurrentIndex();
        if (ci !== -1) this.elements.fileCount.textContent = `${ci + 1} / ${this.files.length}`;
    },

    async restoreFromTrash(item) {
        const { file, trashDir, trashName } = item;
        const th = await trashDir.getFileHandle(trashName);
        const data = await th.getFile();
        const dest = file.parentDir || this.dirHandle;
        const nh = await dest.getFileHandle(file.name, { create: true });
        const w = await nh.createWritable();
        await w.write(data);
        await w.close();
        await trashDir.removeEntry(trashName);
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

    // ---- Capture-date sort support ----

    async ensureDatesTaken() {
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
        await Promise.all(workers);
        this.endTask('taken');
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
            this.showToast('Renaming needs a folder opened with Open Folder');
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
        const input = prompt(
            `Export ${list.length} cop${list.length > 1 ? 'ies' : 'y'} to "jEditor Export".\nMax edge in px (blank = original size):`, ''
        );
        if (input === null) return;
        const maxEdge = parseInt(input, 10) || 0;

        try {
            const dir = await this.dirHandle.getDirectoryHandle('jEditor Export', { create: true });
            let done = 0, failed = 0;
            for (const f of list) {
                try {
                    const data = await f.handle.getFile();
                    let out = data;
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

    // ---- Context menu ----

    initContextMenu() {
        document.addEventListener('contextmenu', (e) => {
            if (this.cropState.active || Dupes.isOpen) { e.preventDefault(); return; }
            if (this.elements.mainInterface.classList.contains('hidden')) return;
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
                return [
                    [`Rotate ${sel.length} Left`, () => this.rotateBulk(-90)],
                    [`Rotate ${sel.length} Right`, () => this.rotateBulk(90)],
                    ['—'],
                    [`Rename ${sel.length}…`, () => this.openRename(sel)],
                    ['Export Copies…', () => this.exportCopies(sel)],
                    ['—'],
                    [`Move ${sel.length} to Trash`, () => this.moveToTrash(sel), true]
                ];
            }
            return [
                ['Open', () => this.openSingle(file)],
                ['—'],
                ['Rotate Left', () => this.rotateImage(file, -90)],
                ['Rotate Right', () => this.rotateImage(file, 90)],
                ['Crop', () => { this.openSingle(file); this.enterCrop(); }],
                ['—'],
                ['Rename…', () => this.promptRename(file)],
                ['File Info', () => { this.toggleInfoPanel(true); }],
                ['Export Copy…', () => this.exportCopies([file])],
                ['—'],
                ['Move to Trash', () => this.moveToTrash([file]), true]
            ];
        }
        if (inSingle) {
            const file = this.currentFile;
            return [
                ['Rotate Left', () => this.rotateImage(file, -90)],
                ['Rotate Right', () => this.rotateImage(file, 90)],
                ['Crop', () => this.enterCrop()],
                ['—'],
                ['Rename…', () => this.promptRename(file)],
                ['File Info', () => this.toggleInfoPanel(true)],
                ['Export Copy…', () => this.exportCopies([file])],
                ['—'],
                ['Fullscreen', () => this.toggleFullscreen()],
                ['Start Slideshow', () => this.startSlideshow()],
                ['—'],
                ['Move to Trash', () => this.moveToTrash([file]), true]
            ];
        }
        return [
            ['Select All', () => { this.selection = new Set(this.files); this.updateSelectionUI(); }],
            ['Clear Selection', () => this.clearSelection()],
            ['—'],
            ['Rename All…', () => this.openRename([])],
            ['Clean Up Folder…', () => this.cleanUpFolder()],
            ['Find Duplicates… (WIP)', () => this.openDupes()],
            ['Start Slideshow', () => this.startSlideshow()],
            ['Fullscreen', () => this.toggleFullscreen()]
        ];
    },

    openContextMenu(items, x, y) {
        this.closeContextMenu();
        const menu = document.createElement('div');
        menu.id = 'context-menu';
        items.forEach(([label, action, danger]) => {
            if (label === '—') {
                const hr = document.createElement('div');
                hr.className = 'ctx-divider';
                menu.appendChild(hr);
                return;
            }
            const btn = document.createElement('button');
            btn.textContent = label;
            if (danger) btn.classList.add('danger');
            btn.onclick = (ev) => {
                ev.stopPropagation();
                this.closeContextMenu();
                action();
            };
            menu.appendChild(btn);
        });
        document.body.appendChild(menu);
        const r = menu.getBoundingClientRect();
        menu.style.left = Math.min(x, window.innerWidth - r.width - 8) + 'px';
        menu.style.top = Math.min(y, window.innerHeight - r.height - 8) + 'px';
    },

    closeContextMenu() {
        const menu = document.getElementById('context-menu');
        if (menu) menu.remove();
    },

    // ---- Crop & Straighten (see crop.js) ----

    async enterCrop() {
        const file = this.currentFile;
        if (!file || this.cropState.active) return;
        if (!this.ensureWritable()) return;
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
            if (this.getCurrentIndex() >= this.files.length - 1) {
                this.showToast('That was the last photo');
                return;
            }
            this.navigate(1);
            this.enterCrop();
        };

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
            // Keep EXIF (dates, camera), colour profile and DPI
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
    }
};

// Start
app.init();
