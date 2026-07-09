const app = {
    dirHandle: null,
    files: [], // Array of { name, handle, size, lastModified, rotation }
    currentFile: null, // The file object currently displayed — files are identified by object, never by index
    viewMode: 'single', // 'single' or 'grid'
    selection: new Set(), // Set of file objects
    readOnlyMode: false, // When true, saving is disabled (legacy drag-drop)
    cropState: { // State for cropping (Cropper.js owns the rest)
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

        // Show Debug Console (Hidden by default, F2 to toggle)
        // document.getElementById('debug-console').style.display = 'block';

        // Crop Controls
        if (this.elements.btnCrop) this.elements.btnCrop.addEventListener('click', () => this.enterCrop());

        // File Info
        if (this.elements.btnInfo) this.elements.btnInfo.addEventListener('click', () => this.toggleInfoPanel());

        // Keyboard
        this.bindKeyboard();

        // Zoom
        this.elements.imageContainer.addEventListener('wheel', (e) => this.handleZoom(e));

        // Pan/Drag
        this.elements.imageContainer.addEventListener('mousedown', (e) => this.handlePanStart(e));
        document.addEventListener('mousemove', (e) => this.handlePanMove(e));
        document.addEventListener('mouseup', () => this.handlePanEnd());

        // Aspect Ratio logic removed (Now part of Cropper.js config if needed)

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

        // Any pointer interaction stops a running slideshow
        document.addEventListener('pointerdown', () => this.stopSlideshow());
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

            this.elements.loading.classList.remove('hidden');
            this.elements.dropZone.classList.add('hidden');

            this.showToast('Scanning folder...', 0, 'scan');
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
            this.elements.loading.classList.add('hidden');
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

    toggleThumbnailFit() {
        this.elements.gridView.classList.toggle('thumb-contain');
        this.elements.thumbnailStrip.classList.toggle('thumb-contain');
        // Optional: flash notification
        // this.showToast('Thumbnail mode toggled', 1000);
    },

    toggleThumbnailStrip() {
        const strip = this.elements.thumbnailStrip;
        if (strip.classList.contains('hidden')) {
            strip.classList.remove('hidden');
            this.elements.btnToggleStrip.style.opacity = '1';
        } else {
            strip.classList.add('hidden');
            this.elements.btnToggleStrip.style.opacity = '0.5';
        }
        this.elements.btnToggleStrip.blur(); // Release focus to restore keyboard shortcuts
    },

    handleZoom(e) {
        if (this.viewMode !== 'single') return;
        if (this.cropState.active) return; // Disable zoom while cropping
        e.preventDefault();

        const delta = -Math.sign(e.deltaY) * 0.1;
        this.zoom += delta;
        if (this.zoom < 0.1) this.zoom = 0.1;
        if (this.zoom > 5) this.zoom = 5;

        // Update cursor based on zoom level
        this.elements.imageContainer.style.cursor = this.zoom > 1 ? 'grab' : 'default';

        this.updateImageTransform();
    },

    updateImageTransform() {
        if (!this.currentFile) return;
        const img = this.elements.currentImage;
        const r = this.getDisplayRotation(this.currentFile, 'full');

        // At odd quarter-turns the CSS-rotated image would overflow the
        // container (layout still sees the unrotated box) — scale it to fit.
        let fit = 1;
        if (((r % 180) + 180) % 180 === 90) {
            const cw = this.elements.imageContainer.clientWidth;
            const ch = this.elements.imageContainer.clientHeight;
            const w = img.offsetWidth, h = img.offsetHeight;
            if (cw && ch && w && h) fit = Math.min(cw / h, ch / w);
        }

        img.style.transform =
            `translate(${this.panX}px, ${this.panY}px) rotate(${r}deg) scale(${this.zoom * fit})`;
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

            if (this.elements.loading) {
                this.elements.loading.classList.remove('hidden');
            } else {
                console.warn('Loading element missing in DOM');
            }

            if (this.elements.dropZone) {
                this.elements.dropZone.classList.add('hidden');
            }

            const items = [...e.dataTransfer.items];
            if (!items || items.length === 0) throw new Error('No items dropped.');

            this.showToast(`Processing ${items.length} items...`, 2000, 'scan');
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
            this.elements.loading.classList.add('hidden');
        } finally {
            this.isLoading = false;
        }
    },

    async finalizeLoad() {
        try {
            // Sort initial files
            this.sortFiles(false); // pass false to avoid re-rendering twice

            if (this.files.length > 0) {
                this.showToast(`Loaded ${this.files.length} images.`, 3000, 'scan');
                this.elements.mainInterface.classList.remove('hidden');

                // Force focus settings
                this.elements.mainInterface.setAttribute('tabindex', '-1');
                this.elements.mainInterface.focus();

                this.renderThumbnails();
                this.renderGrid(); // Prepare grid
                this.loadFile(this.files[0]);

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
            this.elements.loading.classList.add('hidden');
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

    async scanDirectory(dirHandle, prefix = '') {
        try {
            this.showToast('Scanning folder...', 0, 'scan');
            for await (const entry of dirHandle.values()) {
                if (entry.kind === 'file' && this.isImage(entry.name)) {
                    const relPath = prefix + entry.name;
                    // Check for duplicates to allow Refresh
                    if (!this.files.some(f => (f.relPath || f.name) === relPath)) {
                        const fileData = await entry.getFile();
                        this.files.push({
                            name: entry.name,
                            relPath: relPath,
                            parentDir: dirHandle,
                            handle: entry,
                            size: fileData.size,
                            lastModified: fileData.lastModified
                        });
                    }
                    if (this.files.length % 50 === 0) {
                        this.showToast(`Found ${this.files.length} images...`, 0, 'scan');
                    }
                } else if (entry.kind === 'directory') {
                    // Skip our own working folders
                    if (entry.name === '.jeditor-trash' || entry.name === 'jEditor Export') continue;
                    await this.scanDirectory(entry, prefix + entry.name + '/');
                }
            }
        } catch (e) {
            console.warn('Skipping subdirectory due to error:', e);
        }
    },

    async refreshFolder() {
        if (!this.dirHandle) return;
        this.log('Manual Refresh Started');
        this.elements.loading.classList.remove('hidden');
        this.elements.loadingText.textContent = 'Scanning for new photos...';

        try {
            const oldLength = this.files.length;
            await this.scanDirectory(this.dirHandle);

            if (this.files.length > oldLength) {
                this.sortFiles();
                this.precacheThumbnails();
                this.showToast(`Found ${this.files.length - oldLength} new photos`, 3000, 'scan');
            } else {
                this.showToast('Folder is up to date', 2000, 'scan');
            }
        } catch (e) {
            console.error('Refresh failed:', e);
            this.showToast('Refresh failed', 3000, 'scan');
        } finally {
            this.elements.loading.classList.add('hidden');
        }
    },

    isImage(name) {
        return /\.(jpg|jpeg|png|webp|gif)$/i.test(name);
    },

    getCurrentIndex() {
        return this.files.indexOf(this.currentFile);
    },

    // Degrees of CSS rotation a preview needs on top of its cached bitmap:
    // rotation already saved to disk but not baked into that bitmap (lag),
    // plus rotation currently being written, plus rotation still queued.
    getDisplayRotation(file, kind) {
        if (!file) return 0;
        const lag = (kind === 'thumb' ? file.thumbLag : file.fullLag) || 0;
        return lag + (file.savingRotation || 0) + (file.pendingRotation || 0);
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
        el.textContent = this.getDisplayPath(this.currentFile);
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
            if (this.currentFile === file && img.naturalWidth > 0 && this.viewMode === 'single') {
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
                // EXIF exists but has no orientation tag. Adding an entry means
                // shifting every offset in the IFD — not worth it; re-encode.
                return null;
            }
            offset += 2 + size;
        }
        return null;
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
        if (loc.insert) {
            const seg = this.buildOrientationExif(this.composeOrientation(1, deg));
            const bytes = new Uint8Array(buffer);
            return new Blob([bytes.subarray(0, 2), seg, bytes.subarray(2)], { type: 'image/jpeg' });
        }
        const current = view.getUint16(loc.valueOffset, loc.littleEndian);
        view.setUint16(loc.valueOffset, this.composeOrientation(current, deg), loc.littleEndian);
        return new Blob([buffer], { type: 'image/jpeg' });
    },

    // Fallback rotation: decode → rotate on canvas → re-encode in the file's
    // own format. createImageBitmap applies any EXIF orientation, so the
    // output is upright pixels with no EXIF (orientation 1 implied).
    async rotateByReencoding(fileData, name, normalizedDeg) {
        const bitmap = await createImageBitmap(fileData);
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const is90or270 = normalizedDeg === 90 || normalizedDeg === 270;
            canvas.width = is90or270 ? bitmap.height : bitmap.width;
            canvas.height = is90or270 ? bitmap.width : bitmap.height;
            ctx.translate(canvas.width / 2, canvas.height / 2);
            ctx.rotate(normalizedDeg * Math.PI / 180);
            ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
            const { type, quality } = this.getSaveFormat(name);
            return await new Promise(r => canvas.toBlob(r, type, quality));
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
            });
        }
        if (this.elements.currentImage.src && this.elements.currentImage.src.startsWith('blob:')) {
            // We don't want to revoke the src if it's currently being used by a file.fullImageUrl 
            // that we want to keep. But since we clear all fullImageUrls above, it is safe.
            URL.revokeObjectURL(this.elements.currentImage.src);
        }
    },

    analyzeImageBrightness(img) {
        if (!img || !img.width || !img.height) return;

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

            const avgTotal = total / (SIZE * SIZE);
            const avgTop = top / (BAND * SIZE);
            const avgBottom = bottom / (BAND * SIZE);

            // Hysteresis: don't flip a region's theme on borderline photos —
            // it must cross clearly into the other zone to switch.
            const body = document.body;
            const setWithHysteresis = (cls, value) => {
                if (value > 150) body.classList.add(cls);
                else if (value < 120) body.classList.remove(cls);
                // 120–150: keep whatever it was
            };
            setWithHysteresis('light-theme', avgTotal);
            setWithHysteresis('glass-light-top', avgTop);
            setWithHysteresis('glass-light-bottom', avgBottom);
        } catch (e) {
            console.warn('Cannot analyze image brightness (CORS or error)', e);
        }
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
        }, { root: this.elements.thumbnailStrip, margin: '200px' });

        this.files.forEach((file) => {
            const div = document.createElement('div');
            div.className = 'thumb-item';
            div._file = file;
            file._stripEl = div;
            // Placeholder color still useful while loading
            div.style.backgroundColor = '#222';

            div.onclick = () => {
                this.loadFile(file);
                this.setView('single');
            };
            frag.appendChild(div);
            stripObserver.observe(div);
        });
        this.elements.thumbnailStrip.appendChild(frag);
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

            await this.loadImageThumbnail(file, img, force);
        } catch (e) { /* ignore */ }
    },

    updateActiveThumbnail() {
        const thumbs = this.elements.thumbnailStrip.children;
        for (let i = 0; i < thumbs.length; i++) {
            if (thumbs[i]._file === this.currentFile) {
                thumbs[i].classList.add('active');
                thumbs[i].scrollIntoView({ block: 'nearest', inline: 'center' });
            } else {
                thumbs[i].classList.remove('active');
            }
        }
    },

    // Grid View with Lazy Loading
    renderGrid() {
        this.elements.gridView.innerHTML = '';

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

    makeGridTile(file, observer) {
        const div = document.createElement('div');
        div.className = 'grid-item';
        div._file = file;
        file._gridEl = div;

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
            img.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PC9zdmc+';
            observer.observe(img);
        }

        div.appendChild(img);

        div.onclick = (e) => this.handleGridClick(e, file);
        div.ondblclick = () => {
            this.loadFile(file);
            this.setView('single');
        };
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

    getThumbWorker() {
        if (this._thumbWorkerFailed) return null;
        if (this._thumbWorker) return this._thumbWorker;
        try {
            if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
                throw new Error('Worker/OffscreenCanvas unavailable');
            }
            const src = `self.onmessage = async (e) => {
                const { id, file, targetWidth, type } = e.data;
                try {
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
            this._thumbWorker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
            this._thumbJobs = new Map();
            this._thumbWorker.onmessage = (e) => {
                const job = this._thumbJobs.get(e.data.id);
                if (!job) return;
                this._thumbJobs.delete(e.data.id);
                if (e.data.blob) job.resolve(e.data.blob);
                else job.reject(new Error(e.data.error));
            };
            this._thumbWorker.onerror = () => {
                this._thumbWorkerFailed = true;
                const jobs = this._thumbJobs;
                this._thumbJobs = new Map();
                jobs.forEach(j => j.reject(new Error('thumbnail worker crashed')));
            };
        } catch (e) {
            this._thumbWorkerFailed = true;
            this._thumbWorker = null;
        }
        return this._thumbWorker;
    },

    async generateThumbnailBlob(fileData) {
        // Keep alpha-capable formats as PNG so transparency doesn't go black
        const outType = /png|webp|gif/i.test(fileData.type || '') ? 'image/png' : 'image/jpeg';

        const worker = this.getThumbWorker();
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
        try {
            // Don't read mid-save; the rotation queue is quick (EXIF patch)
            while (fileEntry.isBusy) await new Promise(r => setTimeout(r, 30));

            // Bytes read now include everything saved so far; any save that
            // lands while we decode shows up in the lag delta below.
            const savedAtRead = fileEntry._savedRotationTotal || 0;
            const fileData = await fileEntry.handle.getFile();

            let blob;
            if (fileData.size <= this.THUMB_FAST_PATH_BYTES) {
                blob = fileData;
            } else {
                // Persistent cache: reopening a folder skips regeneration.
                // The key includes size+mtime, so edits invalidate naturally.
                const cacheKey = `${fileEntry.relPath || fileEntry.name}|${fileData.size}|${fileData.lastModified}`;
                blob = await this.idbGetThumb(cacheKey);
                if (!blob) {
                    blob = await this.generateThumbnailBlob(fileData);
                    if (blob) this.idbPutThumb(cacheKey, blob);
                }
            }
            if (!blob) throw new Error('Thumbnail encode failed');

            if (fileEntry.thumbnailUrl) URL.revokeObjectURL(fileEntry.thumbnailUrl);
            fileEntry.thumbnailUrl = URL.createObjectURL(blob);
            fileEntry.thumbLag = (fileEntry._savedRotationTotal || 0) - savedAtRead;
            fileEntry._thumbPromise = null;
            this.deliverThumbnail(fileEntry);
            job.resolve(fileEntry.thumbnailUrl);
        } catch (e) {
            fileEntry._thumbPromise = null;
            console.error('Thumbnail error:', e);
            const fallback = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjx0ZXh0IHg9IjEwIiB5PSIyMCIgZm9udC1zaXplPSIyMCI+4pqcPC90ZXh0Pjwvc3ZnPg==';
            (fileEntry._thumbWaiters || []).forEach(img => { img.src = fallback; });
            fileEntry._thumbWaiters = [];
            job.reject(e);
        }
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

    // Pre-generate every thumbnail in the background right after a folder
    // loads, so scrolling the grid only ever hits the cache.
    precacheThumbnails() {
        const missing = this.files.filter(f => !f.thumbnailUrl && !f._thumbPromise);
        if (missing.length === 0) return;

        const total = missing.length;
        const showProgress = total >= 30;
        let done = 0;
        missing.forEach(file => {
            this.ensureThumbnail(file, { urgent: false })
                .catch(() => { })
                .finally(() => {
                    done++;
                    if (!showProgress) return;
                    if (done === total) {
                        this.showToast(`All ${total} previews ready`, 2000, 'precache');
                    } else if (done % 50 === 0) {
                        this.showToast(`Preparing previews ${done}/${total}…`, 0, 'precache');
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
            this.currentFile = file;
            this.elements.fileName.textContent = file.name;
            this.elements.fileCount.textContent = `${this.files.indexOf(file) + 1} / ${this.files.length}`;
            this.updateStatusBar();
            if (this._infoOpen) this.fillInfoPanel(file);
            this.selection.clear();
            this.selection.add(file);
            this.updateSelectionUI();
            this.updateActiveThumbnail();
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

    updateSelectionUI() {
        const gridItems = this.elements.gridView.children;
        for (let i = 0; i < gridItems.length; i++) {
            gridItems[i].classList.toggle('selected', this.selection.has(gridItems[i]._file));
            gridItems[i].classList.toggle('active', gridItems[i]._file === this.currentFile);
        }

        if (this.selection.size > 0) {
            this.elements.selectionBar.classList.remove('hidden');
            this.elements.selectionCount.textContent = `${this.selection.size} items selected`;
        } else {
            this.elements.selectionBar.classList.add('hidden');
        }
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

    async loadFile(file) {
        if (!file) return;

        // Token guards against out-of-order async loads during rapid navigation
        const loadToken = (this._loadToken = (this._loadToken || 0) + 1);

        this.currentFile = file;
        const index = this.files.indexOf(file);

        this.elements.fileName.textContent = file.name;
        this.elements.fileCount.textContent = `${index + 1} / ${this.files.length}`;
        this.updateStatusBar();
        if (this._infoOpen) this.fillInfoPanel(file);

        // Prepare for swap: fast fade out
        this.elements.currentImage.style.opacity = '0';

        // Reset zoom/pan (rotation display is per-file via getDisplayRotation)
        this.zoom = 1;
        this.panX = 0;
        this.panY = 0;

        // CRITICAL FIX: Kill transition immediately to prevent "spin back" or "float"
        this.elements.currentImage.style.transition = 'none';

        // Reset transform immediately
        this.updateImageTransform();

        this.updateActiveThumbnail();

        try {
            let url = file.fullImageUrl;
            if (!url) {
                // Don't read mid-save; the rotation queue is quick
                while (file.isBusy) await new Promise(r => setTimeout(r, 30));
                const savedAtRead = file._savedRotationTotal || 0;
                const fileData = await file.handle.getFile();
                url = URL.createObjectURL(fileData);
                file.fullImageUrl = url;
                // Fresh bytes: lag is only whatever gets saved after this read
                file.fullLag = (file._savedRotationTotal || 0) - savedAtRead;
            }

            // Small delay for DOM to register opacity 0
            await new Promise(r => requestAnimationFrame(r));

            // A newer navigation superseded this one — let it drive the display
            if (this._loadToken !== loadToken) return;

            const img = this.elements.currentImage;

            // RECOVERY LOGIC: If image fails to load (due to revoked blob), re-create it once.
            // { once: true } so these don't pile up across navigations.
            img.addEventListener('error', async () => {
                console.warn('Recovering revoked full-size blob for:', file.name);
                const savedAtRead = file._savedRotationTotal || 0;
                const freshData = await file.handle.getFile();
                const freshUrl = URL.createObjectURL(freshData);
                file.fullImageUrl = freshUrl;
                file.fullLag = (file._savedRotationTotal || 0) - savedAtRead;
                img.src = freshUrl;
                this.updateImageTransform();
            }, { once: true });

            img.src = url;

            await new Promise(resolve => {
                if (img.complete && img.naturalWidth > 0) return resolve();
                img.onload = resolve;
                img.onerror = resolve;
            });
            img.onload = null;
            img.onerror = null;

            if (this._loadToken !== loadToken) return;

            // fullLag may have changed if the URL was freshly created
            this.updateImageTransform();
            this.analyzeImageBrightness(img);

            img.style.transition = 'transform 0.3s ease';
            img.style.opacity = '1';

        } catch (err) {
            console.error('Error loading image:', err);
            this.elements.currentImage.style.opacity = '1';
        }

        // Preload neighbors, trim far-away full-size images
        this.preloadImage(index + 1);
        this.preloadImage(index - 1);
        this.cleanupObjectURLs();
    },

    cleanupObjectURLs() {
        // Thumbnails are small (≈10–30 KB each) and are kept for the whole
        // session. The old distance-based revocation measured distance from
        // the CURRENT photo — scrolling to the middle of a large grid kept
        // destroying and regenerating thumbnails in a loop, which was the
        // main source of scroll lag. Only full-size images get trimmed.
        const cur = this.getCurrentIndex();
        const windowSizeFull = 10;

        const loadedFull = this.files.filter(f => f.fullImageUrl).length;
        if (loadedFull <= windowSizeFull) return;

        this.files.forEach((f, i) => {
            if (f === this.currentFile) return;
            const dist = Math.abs(i - cur);
            if (dist > windowSizeFull && f.fullImageUrl) {
                URL.revokeObjectURL(f.fullImageUrl);
                delete f.fullImageUrl;
            }
        });
    },

    async preloadImage(index) {
        if (index < 0 || index >= this.files.length) return;
        const file = this.files[index];

        if (file.fullImageUrl) return; // Already cached
        if (file.isBusy || file.pendingRotation) return; // Mid-rotation; load on demand later

        try {
            const savedAtRead = file._savedRotationTotal || 0;
            const fileData = await file.handle.getFile();
            const url = URL.createObjectURL(fileData);
            file.fullImageUrl = url;
            file.fullLag = (file._savedRotationTotal || 0) - savedAtRead;
        } catch (e) { /* ignore */ }
    },

    navigate(direction) {
        if (this.files.length === 0) return;
        let newIndex = this.getCurrentIndex() + direction;
        if (newIndex < 0) newIndex = this.files.length - 1;
        if (newIndex >= this.files.length) newIndex = 0;

        const file = this.files[newIndex];

        // In Single View, loadFile handles the display
        this.loadFile(file);

        // In Grid View, we must also update the selection and scroll
        if (this.viewMode === 'grid') {
            this.selection.clear();
            this.selection.add(file);
            this.updateSelectionUI();

            // Scroll into view
            const item = file._gridEl;
            if (item) {
                // Determine if we need to scroll
                const rect = item.getBoundingClientRect();
                const containerRect = this.elements.gridView.getBoundingClientRect();
                if (rect.top < containerRect.top || rect.bottom > containerRect.bottom) {
                    item.scrollIntoView({ block: 'center', behavior: 'smooth' });
                }
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

    bindKeyboard() {
        if (this.boundHandleKey) {
            window.removeEventListener('keydown', this.boundHandleKey);
        }
        this.boundHandleKey = this.handleKey.bind(this);
        window.addEventListener('keydown', this.boundHandleKey);
        // console.log('Keyboard bound to window');
    },

    handleKey(e) {
        // ALWAYS allow F2 for debug
        if (e.key === 'F2') {
            e.preventDefault();
            const debugEl = document.getElementById('debug-console');
            if (debugEl) {
                debugEl.style.display = debugEl.style.display === 'none' ? 'block' : 'none';
                this.log(debugEl.style.display === 'block' ? 'Console Show' : 'Console Hide');
            }
            return;
        }

        // Global safety check: if we are not in main interface, ignore
        if (this.elements.mainInterface.classList.contains('hidden')) return;

        // Escape closes an open context menu before anything else
        if (e.key === 'Escape' && document.getElementById('context-menu')) {
            e.preventDefault();
            this.closeContextMenu();
            return;
        }

        // Undo last edit
        if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
            e.preventDefault();
            this.undo();
            return;
        }

        this.stopSlideshow();

        // Crop blocking
        if (this.cropState.active) {
            if (e.key === 'Escape' || e.key === 'Esc') {
                e.preventDefault();
                e.stopPropagation();
                this.cancelCrop();
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                this.saveCrop();
            }
            return;
        }

        // Navigation & Actions
        switch (e.key) {
            case 'r':
            case 'R':
                e.preventDefault();
                this.refreshFolder();
                break;

            case 'ArrowLeft':
            case 'Left':
                e.stopImmediatePropagation();
                e.preventDefault();
                if (e.shiftKey) this.rotateCurrent(-90);
                else this.navigate(-1);
                break;

            case 'ArrowRight':
            case 'Right':
                e.stopImmediatePropagation();
                e.preventDefault();
                if (e.shiftKey) this.rotateCurrent(90);
                else this.navigate(1);
                break;

            case 'ArrowUp':
            case 'Up':
                if (this.viewMode === 'grid') {
                    e.preventDefault(); e.stopImmediatePropagation();
                    this.navigate(-this.getGridColumnCount());
                }
                break;

            case 'ArrowDown':
            case 'Down':
                if (this.viewMode === 'grid') {
                    e.preventDefault(); e.stopImmediatePropagation();
                    this.navigate(this.getGridColumnCount());
                }
                break;

            case '[':
            case ',':
                this.viewMode === 'grid' ? this.rotateBulk(-90) : this.rotateCurrent(-90);
                break;

            case ']':
            case '.':
                this.viewMode === 'grid' ? this.rotateBulk(90) : this.rotateCurrent(90);
                break;

            case 'Enter':
                if (this.viewMode === 'grid') {
                    e.preventDefault();
                    this.setView('single');
                }
                break;

            case 'Escape':
            case 'Esc':
                e.preventDefault();
                if (this.viewMode === 'single') this.setView('grid');
                else this.clearSelection();
                break;

            case ' ':
            case 'Spacebar':
                e.preventDefault();
                this.toggleView();
                break;

            case 'g':
                this.setView('grid');
                break;
            case 's':
                this.setView('single');
                break;
            case 'c':
                this.enterCrop();
                break;
            case 'i':
                this.toggleInfoPanel();
                break;
            case 'f':
                this.toggleFullscreen();
                break;
            case 'Delete':
                e.preventDefault();
                this.moveToTrash(this.viewMode === 'grid' && this.selection.size
                    ? [...this.selection]
                    : [this.currentFile]);
                break;
        }
    },

    getGridColumnCount() {
        const grid = this.elements.gridView;
        const width = grid.clientWidth;
        // From CSS: repeat(auto-fill, minmax(150px, 1fr)) with 16px gap
        const count = Math.floor((width + 16) / (150 + 16));
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
            img.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PC9zdmc+';
            gridDiv.appendChild(img);

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
    // the disk (thumbLag / fullLag) and keep compensating with CSS. Nothing
    // is re-read or re-decoded after a rotation — that's what makes it snappy.
    // Lags reset to 0 whenever a preview is regenerated from fresh disk bytes.

    async rotateBulk(deg) {
        if (this.selection.size === 0) return;

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

        // Each batch gets its own toast; overlapping batches stack in the UI
        const toastKey = 'rotate-batch-' + (this._batchSeq = (this._batchSeq || 0) + 1);
        const label = `${filesToRotate.length} photo${filesToRotate.length > 1 ? 's' : ''}`;
        this.showToast(`Rotating ${label}…`, 0, toastKey);

        // Drain sequentially to avoid memory spikes; files already being
        // saved by another batch are awaited, not double-processed.
        let ok = true;
        for (const file of filesToRotate) {
            ok = (await this.processRotationQueue(file)) && ok;
        }

        this.showToast(ok ? `Rotated ${label} ${deg > 0 ? 'right' : 'left'}` : `Some photos failed to rotate`, 2000, toastKey);
        this.log('Bulk rotation finished');
    },

    rotateImage(fileEntry, deg) {
        if (!fileEntry) return Promise.resolve(false);

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
        let undoCaptured = false;
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
                const originalBuf = await fileData.arrayBuffer();

                // One undo entry per rotation gesture (Blob snapshots the
                // buffer, so the in-place EXIF patch below can't touch it)
                if (!undoCaptured) {
                    this.pushUndo({
                        type: 'bytes',
                        file: fileEntry,
                        blob: new Blob([originalBuf], { type: fileData.type }),
                        label: 'rotation'
                    });
                    undoCaptured = true;
                }

                // Fast path for JPEGs: patch the EXIF orientation flag.
                // No decode, no re-encode, no quality loss — near-instant.
                let blob = null;
                if (/\.jpe?g$/i.test(fileEntry.name)) {
                    try {
                        blob = this.rotateJpegLossless(originalBuf, normalizedDeg);
                    } catch (e) {
                        this.log('Lossless rotation unavailable, re-encoding: ' + e.message);
                    }
                }

                // Fallback: canvas re-encode (PNG stays pixel-lossless)
                if (!blob) blob = await this.rotateByReencoding(fileData, fileEntry.name, normalizedDeg);
                if (!blob) throw new Error('Blob conversion failed');

                // Re-verify permission
                if (this.dirHandle) {
                    await this.verifyPermission(this.dirHandle, true);
                } else {
                    await this.verifyPermission(fileEntry.handle, true);
                }

                const writable = await fileEntry.handle.createWritable();
                await writable.write(blob);
                await writable.close();

                // Refresh sort metadata — the write changed both
                const newFileData = await fileEntry.handle.getFile();
                fileEntry.size = newFileData.size;
                fileEntry.lastModified = newFileData.lastModified;

                // The cached previews still show pre-save pixels; they now lag
                // the disk by currentDeg more. On-screen totals are unchanged,
                // so nothing needs repainting, reloading or re-decoding.
                fileEntry.thumbLag = (fileEntry.thumbLag || 0) + currentDeg;
                fileEntry.fullLag = (fileEntry.fullLag || 0) + currentDeg;
                // Running total of saved rotation — preview loaders snapshot
                // this around their disk read to compute an exact lag even if
                // a save lands while they are decoding.
                fileEntry._savedRotationTotal = (fileEntry._savedRotationTotal || 0) + currentDeg;
                fileEntry.savingRotation = 0;
            }
            return true;
        } catch (err) {
            console.error('Rotation failed:', err);
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
    UNDO_LIMIT: 10,

    pushUndo(entry) {
        if (!this._undoStack) this._undoStack = [];
        this._undoStack.push(entry);
        while (this._undoStack.length > this.UNDO_LIMIT) this._undoStack.shift();
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
            } else if (entry.type === 'rename') {
                await this.renameFile(entry.file, entry.oldName, { skipUndo: true });
                this.showToast('Rename undone');
            } else if (entry.type === 'batch-rename') {
                for (const it of entry.items) {
                    await this.renameFile(it.file, it.oldName, { skipUndo: true });
                }
                this.showToast(`Batch rename undone (${entry.items.length} files)`);
                this.sortFiles();
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
        f.fullLag = 0;
        f._exif = undefined;
        f.dateTaken = undefined;
        if (f.fullImageUrl) {
            URL.revokeObjectURL(f.fullImageUrl);
            delete f.fullImageUrl;
        }
        this.refreshThumbnailUI(f);
        this.applyPreviewRotation(f);
        if (this.currentFile === f && this.viewMode === 'single') this.loadFile(f);
        if (this._infoOpen && this.currentFile === f) this.fillInfoPanel(f);
    },

    // ---- Trash (safe delete) ----

    async moveToTrash(files) {
        const list = files.filter(Boolean);
        if (!list.length) return;
        if (!this.dirHandle) {
            this.showToast('Deleting requires opening a folder (not loose files)');
            return;
        }
        const undoItems = [];
        try {
            const trashDir = await this.dirHandle.getDirectoryHandle('.jeditor-trash', { create: true });
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
            this.showToast(`Moved ${undoItems.length} to .jeditor-trash — Ctrl+Z to restore`, 4000);
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
        this.showToast('Reading capture dates…', 0, 'taken');
        let i = 0;
        const workers = Array.from({ length: 8 }, async () => {
            while (i < missing.length) {
                const f = missing[i++];
                const exif = await this.getExifInfo(f);
                f.dateTaken = (exif && exif.dateTaken) ? exif.dateTaken.getTime() : (f.lastModified || 0);
            }
        });
        await Promise.all(workers);
        this.showToast('Capture dates loaded', 1500, 'taken');
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
            if (!skipUndo) this.pushUndo({ type: 'rename', file, oldName });

            if (this.currentFile === file) {
                this.elements.fileName.textContent = newName;
                this.updateStatusBar();
                if (this._infoOpen) this.fillInfoPanel(file);
            }
            const gridImg = file._gridEl && file._gridEl.querySelector('img');
            if (gridImg) gridImg.alt = newName;
            return true;
        } catch (e) {
            console.error('Rename failed:', e);
            this.showToast('Rename failed: ' + e.message);
            return false;
        }
    },

    promptRename(file = this.currentFile) {
        if (!file) return;
        const newName = prompt('Rename file:', file.name);
        if (newName !== null) {
            this.renameFile(file, newName).then(ok => {
                if (ok) this.showToast(`Renamed to ${file.name}`);
            });
        }
    },

    async batchRename(files) {
        const list = files.filter(Boolean)
            .sort((a, b) => this.files.indexOf(a) - this.files.indexOf(b));
        if (list.length === 0) return;
        if (list.length === 1) { this.promptRename(list[0]); return; }

        const pattern = prompt(
            `Rename ${list.length} files.\n{n} = number, {name} = original name:`,
            'photo_{n}'
        );
        if (!pattern) return;
        if (!pattern.includes('{n}')) {
            this.showToast('The pattern needs {n} to keep names unique');
            return;
        }
        const pad = String(list.length).length;
        const items = [];
        let n = 1;
        for (const f of list) {
            const ext = (f.name.match(/\.\w+$/) || [''])[0];
            const base = f.name.replace(/\.\w+$/, '');
            const newName = pattern
                .replaceAll('{n}', String(n).padStart(pad, '0'))
                .replaceAll('{name}', base) + ext;
            const oldName = f.name;
            if (await this.renameFile(f, newName, { skipUndo: true })) {
                items.push({ file: f, oldName });
            }
            n++;
        }
        if (items.length) {
            this.pushUndo({ type: 'batch-rename', items });
            this.showToast(`Renamed ${items.length} files — Ctrl+Z to undo`);
            this.sortFiles();
        }
    },

    // ---- Persistent thumbnail cache (IndexedDB) ----

    idb() {
        if (this._idbPromise !== undefined) return this._idbPromise;
        this._idbPromise = new Promise((resolve) => {
            try {
                const req = indexedDB.open('jeditor', 1);
                req.onupgradeneeded = () => req.result.createObjectStore('thumbs');
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => resolve(null);
            } catch (e) {
                resolve(null);
            }
        });
        return this._idbPromise;
    },

    async idbGetThumb(key) {
        const db = await this.idb();
        if (!db) return null;
        return new Promise((res) => {
            try {
                const req = db.transaction('thumbs', 'readonly').objectStore('thumbs').get(key);
                req.onsuccess = () => res(req.result || null);
                req.onerror = () => res(null);
            } catch (e) {
                res(null);
            }
        });
    },

    async idbPutThumb(key, blob) {
        const db = await this.idb();
        if (!db) return;
        try {
            db.transaction('thumbs', 'readwrite').objectStore('thumbs').put(blob, key);
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
                this.showToast(`Exporting ${done + failed}/${list.length}…`, 0, 'export');
            }
            this.showToast(
                failed ? `Exported ${done}, ${failed} failed` : `Exported ${done} to "jEditor Export"`,
                3000, 'export'
            );
        } catch (e) {
            this.showToast('Export failed: ' + e.message, 3000, 'export');
        }
    },

    // ---- Context menu ----

    initContextMenu() {
        document.addEventListener('contextmenu', (e) => {
            if (this.cropState.active) return;
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
                    ['Batch Rename…', () => this.batchRename(sel)],
                    ['Export Copies…', () => this.exportCopies(sel)],
                    ['—'],
                    [`Move ${sel.length} to Trash`, () => this.moveToTrash(sel), true]
                ];
            }
            return [
                ['Open', () => { this.loadFile(file); this.setView('single'); }],
                ['—'],
                ['Rotate Left', () => this.rotateImage(file, -90)],
                ['Rotate Right', () => this.rotateImage(file, 90)],
                ['Crop', () => { this.loadFile(file); this.setView('single'); this.enterCrop(); }],
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

    // Crop Logic
    enterCrop() {
        if (typeof Cropper === 'undefined') {
            this.showToast('Crop library failed to load — check cropper.min.js');
            return;
        }
        if (this.cropState.active) return;
        if (this.currentFile && /\.gif$/i.test(this.currentFile.name)) {
            this.showToast('Cropping GIFs is not supported (animation would be lost)');
            return;
        }
        if (this.viewMode !== 'single') this.setView('single');
        this.zoom = 1;
        this.panX = 0;
        this.panY = 0;
        this.updateImageTransform();

        // 1. Hide Controls & Strip
        document.querySelector('.controls').classList.add('hidden');
        document.getElementById('thumbnail-strip').classList.add('hidden');

        // 2. Initialize Cropper
        const image = this.elements.currentImage;

        // Destroy existing if any
        if (this.cropper) {
            this.cropper.destroy();
        }

        this.cropper = new Cropper(image, {
            viewMode: 1,
            dragMode: 'move',
            background: false,
            autoCropArea: 1,
            zoomable: true,
            rotatable: true,
            scalable: false,
            guides: true,
            center: true,
            highlight: false,
            cropBoxMovable: true,
            cropBoxResizable: true,
            toggleDragModeOnDblclick: false,
            ready: () => {
                this.showCropperToolbar();
            }
        });

        this.cropState.active = true;
    },

    cancelCrop() {
        if (this.cropper) {
            this.cropper.destroy();
            this.cropper = null;
        }
        this.cropState.active = false;

        // Hide toolbar
        const toolbar = document.getElementById('cropper-toolbar');
        if (toolbar) toolbar.classList.add('hidden');

        // Restore main UI visibility
        document.querySelector('.controls')?.classList.remove('hidden');
        document.getElementById('thumbnail-strip')?.classList.remove('hidden');
    },

    showCropperToolbar() {
        let toolbar = document.getElementById('cropper-toolbar');
        if (!toolbar) {
            toolbar = document.createElement('div');
            toolbar.id = 'cropper-toolbar';
            toolbar.style.cssText = `
                position: fixed;
                bottom: 20px;
                left: 50%;
                transform: translateX(-50%);
                z-index: 2000;
                display: flex;
                gap: 12px;
                background: var(--glass-bottom-bg);
                color: var(--glass-bottom-text);
                padding: 12px 24px;
                border-radius: 999px;
                border: 1px solid var(--glass-bottom-border);
                backdrop-filter: var(--backdrop-filter);
                -webkit-backdrop-filter: var(--backdrop-filter);
                box-shadow: 0 8px 32px rgba(0,0,0,0.4);
                transition: background 0.35s ease, color 0.35s ease;
            `;

            toolbar.innerHTML = `
                <button id="cropper-cancel" style="color: inherit; background: transparent; border: none; font-size: 14px; cursor: pointer; padding: 8px 16px;">Cancel</button>
                <div style="width: 1px; background: var(--glass-bottom-border); margin: 4px 0;"></div>
                <button id="cropper-rotate-left" style="color: inherit; background: transparent; border: none; font-size: 18px; cursor: pointer; padding: 8px 12px;" title="Rotate Left">↺</button>
                <button id="cropper-rotate-right" style="color: inherit; background: transparent; border: none; font-size: 18px; cursor: pointer; padding: 8px 12px;" title="Rotate Right">↻</button>
                <div style="width: 1px; background: var(--glass-bottom-border); margin: 4px 0;"></div>
                <button id="cropper-save" style="color: #fff; background: var(--accent-color); border: none; font-size: 14px; font-weight: 600; cursor: pointer; padding: 8px 24px; border-radius: 999px;">Save</button>
            `;
            document.body.appendChild(toolbar);

            document.getElementById('cropper-cancel').onclick = () => this.cancelCrop();
            document.getElementById('cropper-save').onclick = () => this.saveCrop();
            document.getElementById('cropper-rotate-left').onclick = () => this.cropper.rotate(-90);
            document.getElementById('cropper-rotate-right').onclick = () => this.cropper.rotate(90);
        }
        toolbar.classList.remove('hidden');
    },

    async saveCrop() {
        if (!this.cropper) return;

        this.elements.loading.classList.remove('hidden');
        if (this.elements.loadingText) this.elements.loadingText.textContent = 'Saving...';

        try {
            const canvas = this.cropper.getCroppedCanvas();
            const fileEntry = this.currentFile;
            if (!fileEntry) throw new Error('No file selected');

            const { type, quality } = this.getSaveFormat(fileEntry.name);
            const blob = await new Promise(r => canvas.toBlob(r, type, quality));
            if (!blob) throw new Error('Encoding failed');

            // Capture pre-crop bytes for undo
            const before = await fileEntry.handle.getFile();
            this.pushUndo({
                type: 'bytes',
                file: fileEntry,
                blob: new Blob([await before.arrayBuffer()], { type: before.type }),
                label: 'crop'
            });

            // Re-verify permission
            if (this.dirHandle) {
                await this.verifyPermission(this.dirHandle, true);
            } else {
                await this.verifyPermission(fileEntry.handle, true);
            }

            const writable = await fileEntry.handle.createWritable();
            await writable.write(blob);
            await writable.close();

            // The crop bakes all pixels upright — reset rotation bookkeeping
            fileEntry.pendingRotation = 0;
            fileEntry.savingRotation = 0;
            fileEntry.thumbLag = 0;
            fileEntry.fullLag = 0;

            this.refreshThumbnailUI(fileEntry);
            if (fileEntry.fullImageUrl) URL.revokeObjectURL(fileEntry.fullImageUrl);
            const newFileData = await fileEntry.handle.getFile();
            fileEntry.size = newFileData.size;
            fileEntry.lastModified = newFileData.lastModified;
            const newUrl = URL.createObjectURL(newFileData);
            fileEntry.fullImageUrl = newUrl;

            // Exit crop mode first (destroys the cropper), then swap in the result.
            // cropper.replace() here would re-render the whole cropper just to destroy it.
            this.cancelCrop();
            this.elements.currentImage.src = newUrl;
            this.updateImageTransform();

            this.showToast("Image saved successfully");

        } catch (err) {
            console.error(err);
            this.showToast("Failed to save image");
        } finally {
            this.elements.loading.classList.add('hidden');
        }
    },

    resetCrop() {
        if (this.cropper) {
            this.cropper.reset();
        }
    }
};

// Start
app.init();
