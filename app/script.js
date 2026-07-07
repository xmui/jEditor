const app = {
    dirHandle: null,
    files: [], // Array of { name, handle, rotation: 0 } 
    currentIndex: 0,
    viewMode: 'single', // 'single' or 'grid'
    selection: new Set(), // Set of indices
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
        btnCropFloat: document.getElementById('btn-crop-float'),
        loadingText: document.getElementById('loading-text'),
        gridControls: document.getElementById('grid-controls'),
        gridSizeSlider: document.getElementById('grid-size-slider'),
        sortModeSelect: document.getElementById('sort-mode'),
        btnToggleStrip: document.getElementById('btn-toggle-strip')
    },

    init() {
        // Debug
        this.log('App Initializing...');

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
        document.getElementById('btn-clear-selection').addEventListener('click', () => this.clearSelection());
        document.getElementById('btn-refresh').addEventListener('click', () => this.refreshFolder());

        // Show Debug Console (Hidden by default, F2 to toggle)
        // document.getElementById('debug-console').style.display = 'block';

        // Crop Controls
        if (this.elements.btnCrop) this.elements.btnCrop.addEventListener('click', () => this.enterCrop());
        if (this.elements.btnCropFloat) this.elements.btnCropFloat.addEventListener('click', () => this.enterCrop());

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

        // Sort Control
        this.elements.sortModeSelect.addEventListener('change', (e) => {
            this.sortMode = e.target.value;
            this.sortFiles();
        });
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

            this.showToast('Scanning folder...', 0);
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
        if (!this.files[this.currentIndex]) return;
        const r = this.files[this.currentIndex].rotation || 0;

        this.elements.currentImage.style.transform =
            `translate(${this.panX}px, ${this.panY}px) rotate(${r}deg) scale(${this.zoom})`;
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

            this.showToast(`Processing ${items.length} items...`, 2000);
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
                this.showToast(`Loaded ${this.files.length} images.`, 3000);
                this.elements.mainInterface.classList.remove('hidden');

                // Force focus settings
                this.elements.mainInterface.setAttribute('tabindex', '-1');
                this.elements.mainInterface.focus();

                this.renderThumbnails();
                this.renderGrid(); // Prepare grid
                this.loadIndex(0);
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

    async scanDirectory(dirHandle) {
        try {
            this.showToast('Scanning folder...', 0);
            for await (const entry of dirHandle.values()) {
                if (entry.kind === 'file' && this.isImage(entry.name)) {
                    // Check for duplicates to allow Refresh
                    if (!this.files.some(f => f.name === entry.name)) {
                        const fileData = await entry.getFile();
                        this.files.push({
                            name: entry.name,
                            handle: entry,
                            size: fileData.size,
                            lastModified: fileData.lastModified
                        });
                    }
                    if (this.files.length % 50 === 0) {
                        this.showToast(`Found ${this.files.length} images...`, 0);
                    }
                } else if (entry.kind === 'directory') {
                    await this.scanDirectory(entry);
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
                this.showToast(`Found ${this.files.length - oldLength} new photos`, 3000);
            } else {
                this.showToast('Folder is up to date', 2000);
            }
        } catch (e) {
            console.error('Refresh failed:', e);
            this.showToast('Refresh failed');
        } finally {
            this.elements.loading.classList.add('hidden');
        }
    },

    isImage(name) {
        return /\.(jpg|jpeg|png|webp|gif)$/i.test(name);
    },

    sortFiles(render = true) {
        const mode = this.sortMode;

        // Selection and currentIndex are index-based; remember the actual file
        // objects so we can remap after the order changes.
        const currentFile = this.files[this.currentIndex];
        const selectedFiles = new Set([...this.selection].map(i => this.files[i]).filter(Boolean));

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
            }

            if (typeof valA === 'string') {
                const cmp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
                return mode.endsWith('asc') ? cmp : -cmp;
            } else {
                return mode.endsWith('asc') ? valA - valB : valB - valA;
            }
        });

        // Remap current photo and selection to their new positions
        if (currentFile) {
            const newIdx = this.files.indexOf(currentFile);
            if (newIdx !== -1) this.currentIndex = newIdx;
        }
        this.selection = new Set(
            this.files.map((f, i) => (selectedFiles.has(f) ? i : -1)).filter(i => i !== -1)
        );

        if (render) {
            this.renderThumbnails();
            this.renderGrid();
            this.updateActiveThumbnail();
            this.updateSelectionUI();
            this.elements.fileCount.textContent = `${this.currentIndex + 1} / ${this.files.length}`;
        }
    },

    cleanupURLs() {
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

        // Create a small canvas to analyze
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 50;
        canvas.height = 50;

        // Draw image resized
        ctx.drawImage(img, 0, 0, 50, 50);

        try {
            const imageData = ctx.getImageData(0, 0, 50, 50);
            const data = imageData.data;
            let r, g, b, avg;
            let colorSum = 0;

            for (let x = 0, len = data.length; x < len; x += 4) {
                r = data[x];
                g = data[x + 1];
                b = data[x + 2];

                // Calculate perceived brightness
                avg = Math.floor((r * 0.299) + (g * 0.587) + (b * 0.114));
                colorSum += avg;
            }

            const brightness = Math.floor(colorSum / (50 * 50));
            // Threshold for creating contrast (if > 128, it's bright)
            // Using slightly higher threshold to prefer dark theme
            const isBright = brightness > 140;

            if (isBright) {
                document.body.classList.add('light-theme');
            } else {
                document.body.classList.remove('light-theme');
            }
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
                    const index = parseInt(div.dataset.index);
                    // Load small thumbnail as bg image
                    this.loadStripThumbnail(index, div);
                    stripObserver.unobserve(div);
                }
            });
        }, { root: this.elements.thumbnailStrip, margin: '200px' });

        this.files.forEach((file, index) => {
            const div = document.createElement('div');
            div.className = 'thumb-item';
            div.dataset.index = index;
            // Placeholder color still useful while loading
            div.style.backgroundColor = '#222';

            div.onclick = () => {
                this.loadIndex(index);
                this.setView('single');
            };
            frag.appendChild(div);
            stripObserver.observe(div);
        });
        this.elements.thumbnailStrip.appendChild(frag);
        this.updateActiveThumbnail();
    },

    async loadStripThumbnail(index, div, force = false) {
        if (!this.files[index]) return;
        try {
            // Reuse the internal logic effectively but target the div background or an img inside
            // To keep style simple, let's add an img inside
            const img = document.createElement('img');
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            img.style.pointerEvents = 'none'; // let click pass to div
            div.appendChild(img);

            await this.loadImageThumbnail(index, img, force);
        } catch (e) { /* ignore */ }
    },

    updateActiveThumbnail() {
        const thumbs = this.elements.thumbnailStrip.children;
        for (let i = 0; i < thumbs.length; i++) {
            if (i === this.currentIndex) {
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

        // Use viewport as root (null) to ensure it triggers correctly even if container sizing is tricky
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                const img = entry.target;
                const index = parseInt(img.dataset.index);
                const file = this.files[index];

                if (entry.isIntersecting) {
                    file.isVisible = true; // Mark as visible
                    // Hyper-Parallel Load: 50ms pulse
                    if (file.loadTimeout) clearTimeout(file.loadTimeout);
                    file.loadTimeout = setTimeout(() => {
                        this.loadImageThumbnail(index, img);
                        file.loadTimeout = null;
                        this.cleanupObjectURLs();
                    }, 50);
                } else {
                    file.isVisible = false; // Mark as hidden
                    if (file.loadTimeout) {
                        clearTimeout(file.loadTimeout);
                        file.loadTimeout = null;
                    }
                    img.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjwvc3ZnPg==';
                }
            });
        }, { root: null, rootMargin: '500px' });
        this.elements.gridView._observer = observer; // Stash for refreshThumbnailUI

        this.files.forEach((file, index) => {
            const div = document.createElement('div');
            div.className = 'grid-item';
            div.dataset.index = index;

            // Use canvas for grid to reduce memory (no large Image element retaining full blob)
            // Or just img with small src.
            const img = document.createElement('img');
            img.dataset.index = index;
            img.alt = file.name;
            img.loading = "lazy"; // Native lazy load as backup
            img.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PC9zdmc+';

            div.appendChild(img);

            div.onclick = (e) => this.handleGridClick(e, index);
            div.ondblclick = () => {
                this.loadIndex(index);
                this.setView('single');
            };

            this.elements.gridView.appendChild(div);
            observer.observe(img);
        });
    },

    async loadImageThumbnail(index, imgElement, force = false) {
        if (!this.files[index]) return;
        const fileEntry = this.files[index];

        // Track elements that need this thumbnail
        if (!fileEntry._thumbWaiters) fileEntry._thumbWaiters = [];
        if (imgElement && !fileEntry._thumbWaiters.includes(imgElement)) {
            fileEntry._thumbWaiters.push(imgElement);
        }

        if (!force && fileEntry.thumbnailUrl) {
            const url = fileEntry.thumbnailUrl;
            fileEntry._thumbWaiters.forEach(img => { img.src = url; });
            fileEntry._thumbWaiters = [];
            return;
        }

        if (!force && fileEntry.isLoading) return;
        fileEntry.isLoading = true;

        try {
            const fileData = await fileEntry.handle.getFile();

            // Fast Path: If image is already reasonably small, just use it
            if (fileData.size < 200 * 1024) {
                const url = URL.createObjectURL(fileData);
                fileEntry.thumbnailUrl = url;
                fileEntry._thumbWaiters.forEach(img => { img.src = url; });
                fileEntry._thumbWaiters = [];
                fileEntry.isLoading = false;
                return;
            }

            // Standard Path: Downscale for performance
            const bitmap = await createImageBitmap(fileData, { resizeWidth: 300 });
            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(bitmap, 0, 0);

            canvas.toBlob(blob => {
                const url = URL.createObjectURL(blob);
                fileEntry.thumbnailUrl = url;
                fileEntry._thumbWaiters.forEach(img => { img.src = url; });
                fileEntry._thumbWaiters = [];
                fileEntry.isLoading = false;
                bitmap.close(); // Explicitly close bitmap
            }, 'image/jpeg', 0.8);

        } catch (e) {
            fileEntry.isLoading = false;
            console.error('Thumbnail error:', e);
            const fallback = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjx0ZXh0IHg9IjEwIiB5PSIyMCIgZm9udC1zaXplPSIyMCI+4pqcPC90ZXh0Pjwvc3ZnPg==';
            fileEntry._thumbWaiters.forEach(img => { img.src = fallback; });
            fileEntry._thumbWaiters = [];
        }
    },


    handleGridClick(e, index) {
        if (e.ctrlKey || e.metaKey) {
            this.toggleSelection(index);
        } else if (e.shiftKey) {
            // Range selection
            // Find closest selected or current
            // For now simple shift: from currentIndex to this index
            const start = Math.min(this.currentIndex, index);
            const end = Math.max(this.currentIndex, index);
            this.selection.clear();
            for (let i = start; i <= end; i++) this.selection.add(i);
            this.updateSelectionUI();
        } else {
            // Single select. Don't loadIndex() here — that decodes the
            // full-resolution image into the hidden single view on every
            // grid click. Double-click / Enter opens the photo.
            this.currentIndex = index;
            const file = this.files[index];
            if (file) {
                this.elements.fileName.textContent = file.name;
                this.elements.fileCount.textContent = `${index + 1} / ${this.files.length}`;
            }
            this.selection.clear();
            this.selection.add(index);
            this.updateSelectionUI();
            this.updateActiveThumbnail();
        }
    },

    toggleSelection(index) {
        if (this.selection.has(index)) {
            this.selection.delete(index);
        } else {
            this.selection.add(index);
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
            gridItems[i].classList.toggle('selected', this.selection.has(i));
            gridItems[i].classList.toggle('active', i === this.currentIndex);
            // Also update rotation visual if needed (not implemented in grid items CSS transform yet, only img src usually)
            // But if we want to show rotation in grid, we need to transform the IMG.
            // We'll trust the thumbnail reload.
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
            if (this.selection.size === 0 && this.currentIndex >= 0) {
                this.selection.add(this.currentIndex);
            }
            this.updateSelectionUI();

            // Scroll to current
            if (this.files[this.currentIndex]) {
                // setTimeout to allow layout
                setTimeout(() => {
                    this.elements.gridView.children[this.currentIndex]?.scrollIntoView({ block: 'center' });
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
            // Usually keeping is confusing if you just want to flip. Let's keep but only active is `currentIndex`.
            this.elements.selectionBar.classList.add('hidden');

            this.loadIndex(this.currentIndex);
        }
    },

    async loadIndex(index) {
        if (index < 0) index = this.files.length - 1;
        if (index >= this.files.length) index = 0;

        // Token guards against out-of-order async loads during rapid navigation
        const loadToken = (this._loadToken = (this._loadToken || 0) + 1);

        this.currentIndex = index;
        const file = this.files[this.currentIndex];

        this.elements.fileName.textContent = file.name;
        this.elements.fileCount.textContent = `${index + 1} / ${this.files.length}`;

        // Prepare for swap: fast fade out
        this.elements.currentImage.style.opacity = '0';

        // Reset zoom/pan/rotation
        this.zoom = 1;
        this.panX = 0;
        this.panY = 0;
        // Do not reset file.rotation here?
        // Wait, if we navigated, we want to see the stored state? 
        // file.rotation = 0; // We keep temporary unsaved rotation? No, usually reset on navigate if unsaved.
        // The user complained about weirdness. If they rotated, then navigated, the saving happens in background.
        // The new file should start at 0 rotation (unless it has saved rotation property, which we reset to 0 in save).

        // CRITICAL FIX: Kill transition immediately to prevent "spin back" or "float"
        this.elements.currentImage.style.transition = 'none';

        // Reset transform immediately
        this.updateImageTransform();

        this.updateActiveThumbnail();

        try {
            let url = file.fullImageUrl;
            if (!url) {
                const fileData = await file.handle.getFile();
                url = URL.createObjectURL(fileData);
                file.fullImageUrl = url;
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
                const freshData = await file.handle.getFile();
                const freshUrl = URL.createObjectURL(freshData);
                file.fullImageUrl = freshUrl;
                img.src = freshUrl;
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

            this.analyzeImageBrightness(img);

            img.style.transition = 'transform 0.3s ease';
            img.style.opacity = '1';

        } catch (err) {
            console.error('Error loading image:', err);
            this.elements.currentImage.style.opacity = '1';
        }

        // Preload neighbors
        this.preloadImage(index + 1);
        this.preloadImage(index - 1);
    },

    cleanupObjectURLs() {
        // High-Water Mark: Only cleanup if we are over a certain count to avoid thrashing
        const loadedThumbs = this.files.filter(f => f.thumbnailUrl).length;
        const loadedFull = this.files.filter(f => f.fullImageUrl).length;

        const cur = this.currentIndex;
        const windowSizeFull = 10;
        const windowSizeThumb = 150; // Increased buffer for modern RAM

        // Only cleanup if we are pushing limits
        if (loadedFull > windowSizeFull || loadedThumbs > windowSizeThumb) {
            this.files.forEach((f, i) => {
                // NEVER revoke if image is visible in grid or main view
                if (f.isVisible) return;

                const dist = Math.abs(i - cur);

                // Never revoke the CURRENT view window or immediate neighbors
                if (dist < 15) return;

                if (dist > windowSizeFull && f.fullImageUrl) {
                    URL.revokeObjectURL(f.fullImageUrl);
                    delete f.fullImageUrl;
                }
                if (dist > windowSizeThumb && f.thumbnailUrl) {
                    URL.revokeObjectURL(f.thumbnailUrl);
                    delete f.thumbnailUrl;
                }
            });
        }
    },

    async preloadImage(index) {
        if (index < 0 || index >= this.files.length) return;
        const file = this.files[index];

        if (file.fullImageUrl) return; // Already cached

        try {
            const fileData = await file.handle.getFile();
            const url = URL.createObjectURL(fileData);
            file.fullImageUrl = url;
        } catch (e) { /* ignore */ }
    },

    navigate(direction) {
        let newIndex = this.currentIndex + direction;
        if (newIndex < 0) newIndex = this.files.length - 1;
        if (newIndex >= this.files.length) newIndex = 0;

        // In Single View, loadIndex handles the display
        this.loadIndex(newIndex);

        // In Grid View, we must also update the selection and scroll
        if (this.viewMode === 'grid') {
            this.selection.clear();
            this.selection.add(newIndex);
            this.updateSelectionUI();

            // Scroll into view
            const item = this.elements.gridView.children[newIndex];
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

    showToast(message, duration = 3000) {
        let toast = document.getElementById('toast-notification');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'toast-notification';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.classList.add('visible');

        if (this.toastTimeout) clearTimeout(this.toastTimeout);
        if (duration > 0) {
            this.toastTimeout = setTimeout(() => {
                toast.classList.remove('visible');
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
        this.rotateImage(this.currentIndex, deg);
    },

    refreshThumbnailUI(index) {
        // 1. Refresh Strip Item
        const stripDiv = this.elements.thumbnailStrip.querySelector(`.thumb-item[data-index="${index}"]`);
        if (stripDiv) {
            stripDiv.innerHTML = '';
            this.loadStripThumbnail(index, stripDiv, true);
        }

        // 2. Refresh Grid Item
        const gridDiv = this.elements.gridView.querySelector(`.grid-item[data-index="${index}"]`);
        if (gridDiv) {
            gridDiv.innerHTML = '';
            // Recreate Image
            const img = document.createElement('img');
            img.dataset.index = index;
            img.alt = this.files[index].name;
            img.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PC9zdmc+';
            gridDiv.appendChild(img);

            // Re-observe
            const gridObserver = this.elements.gridView._observer;
            if (gridObserver) gridObserver.observe(img);

            // Force reload
            this.loadImageThumbnail(index, img, true);
        }
    },

    async rotateBulk(deg) {
        if (this.selection.size === 0) return;

        // Snapshot the selected FILES now. Set iterators see items added during
        // iteration, so iterating this.selection live while awaiting would
        // rotate photos the user clicks mid-operation. Snapshotting file
        // objects (not indices) also survives a re-sort while rotating.
        const filesToRotate = [...this.selection].map(i => this.files[i]).filter(Boolean);
        const indexOf = (file) => this.files.indexOf(file);

        // Concurrency Guard: If already rotating, wait or queue
        if (this.isBulkRotating) {
            // We'll trust the individual file pendingRotation logic for now,
            // but we MUST not let this call clear the loading indicator.
            for (const file of filesToRotate) {
                const idx = indexOf(file);
                if (idx !== -1) this.rotateImage(idx, deg, true);
            }
            return;
        }

        this.isBulkRotating = true;
        this.elements.loading.classList.remove('hidden');
        if (this.elements.loadingText) this.elements.loadingText.textContent = `Rotating ${filesToRotate.length} images...`;

        // Process sequentially to avoid memory spikes / file locks
        for (const file of filesToRotate) {
            const idx = indexOf(file);
            if (idx !== -1) await this.rotateImage(idx, deg, true); // true = skip UI reload per item
        }

        // Final refresh of all selected items
        filesToRotate.forEach(file => {
            const idx = indexOf(file);
            if (idx !== -1) this.refreshThumbnailUI(idx);
        });

        if (this.viewMode === 'single') {
            this.loadIndex(this.currentIndex);
        }

        this.elements.loading.classList.add('hidden');
        if (this.elements.loadingText) this.elements.loadingText.textContent = 'Processing...';
        this.isBulkRotating = false;
        this.log("Bulk rotation finished");
    },

    async rotateImage(index, deg, skipUI = false) {
        const fileEntry = this.files[index];
        if (!fileEntry) return;

        // Optimistic UI Update: immediately update rotation visually
        if (!skipUI) {
            fileEntry.rotation = (fileEntry.rotation || 0) + deg;
            // Only update current view if we are still looking at this image
            if (this.viewMode === 'single' && this.files[this.currentIndex] === fileEntry) {
                this.updateImageTransform();
            }
        }

        // Queue the rotation
        if (!fileEntry.pendingRotation) fileEntry.pendingRotation = 0;
        fileEntry.pendingRotation += deg;

        // UNIFIED LOCK: Wait if either rotating or saving
        if (fileEntry.isBusy) return;
        fileEntry.isBusy = true;

        // UI Indicator (Non-blocking)
        if (!skipUI) {
            this.elements.loading.classList.remove('hidden');
            if (this.elements.loadingText) this.elements.loadingText.textContent = 'Saving...';
        }

        try {
            // Process ALL queued rotations for this file
            while (fileEntry.pendingRotation !== 0) {
                const currentDeg = fileEntry.pendingRotation;
                fileEntry.pendingRotation = 0;

                // Normalize
                const normalizedDeg = ((currentDeg % 360) + 360) % 360;
                if (normalizedDeg === 0) continue;

                // HARDENING: Fresh handle check
                const fileData = await fileEntry.handle.getFile();
                const bitmap = await createImageBitmap(fileData);
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const is90or270 = normalizedDeg === 90 || normalizedDeg === 270;

                canvas.width = is90or270 ? bitmap.height : bitmap.width;
                canvas.height = is90or270 ? bitmap.width : bitmap.height;

                ctx.translate(canvas.width / 2, canvas.height / 2);
                ctx.rotate(normalizedDeg * Math.PI / 180);
                ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);

                const blob = await new Promise(r => canvas.toBlob(r, fileData.type || 'image/jpeg', 0.95));
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

                // Reset internal rotation as file is saved
                fileEntry.rotation = 0;
                // Invalidate URLs
                if (fileEntry.fullImageUrl) URL.revokeObjectURL(fileEntry.fullImageUrl);
                delete fileEntry.fullImageUrl;

                // Refresh Thumbnail ALWAYS (re-resolve index in case order changed)
                const liveIndex = this.files.indexOf(fileEntry);
                if (liveIndex !== -1) this.refreshThumbnailUI(liveIndex);

                // Update Single View ONLY if still active on this file
                if (!skipUI && this.viewMode === 'single' && this.files[this.currentIndex] === fileEntry) {
                    const newFileData = await fileEntry.handle.getFile();
                    const newUrl = URL.createObjectURL(newFileData);
                    fileEntry.fullImageUrl = newUrl;

                    // Fade swap for smoothness
                    // We don't need a fade out if we just updated the source, 
                    // but we do need to reset the transform if the underlying image is now rotated 
                    // (which it is, we saved it).
                    // Actually, since we reset fileEntry.rotation = 0, updating transform is correct.

                    // Disable transition to prevent "spin back" glitch when swapping source and resetting transform
                    this.elements.currentImage.style.transition = 'none';

                    this.elements.currentImage.src = newUrl;
                    this.updateImageTransform(); // Will see rotation=0

                    // Force Layout
                    void this.elements.currentImage.offsetWidth;

                    // Restore transition logic (matches loadIndex behavior, maybe don't even need to restore aggressively if we rely on next interaction?)
                    // But if user zooms/pans immediately, we might want it back.
                    // Actually, let's restore it in a timeout or on next interaction
                    setTimeout(() => {
                        this.elements.currentImage.style.transition = 'transform 0.3s ease';
                    }, 50);
                }

                bitmap.close();
            }
        } catch (err) {
            console.error('Rotation failed:', err);
            fileEntry.pendingRotation = 0;
            // Roll back the optimistic preview so the screen matches the file on disk
            fileEntry.rotation = 0;
            if (this.viewMode === 'single' && this.files[this.currentIndex] === fileEntry) {
                this.updateImageTransform();
            }
            this.showToast("Rotation failed: File may be in use");
        } finally {
            fileEntry.isBusy = false;
            // Hide loading only if NO other files are busy? 
            // Simplified: Hide it. If another starts, it will show again.
            // Or better: check if any are busy.
            if (!this.files.some(f => f.isBusy)) {
                this.elements.loading.classList.add('hidden');
            }
        }
    },
    // Crop Logic
    enterCrop() {
        if (typeof Cropper === 'undefined') {
            this.showToast('Crop library failed to load — check cropper.min.js');
            return;
        }
        if (this.cropState.active) return;
        if (this.viewMode !== 'single') this.setView('single');
        this.zoom = 1;
        this.panX = 0;
        this.panY = 0;
        this.updateImageTransform();

        // 1. Hide Controls & Strip
        document.querySelector('.controls').classList.add('hidden');
        document.getElementById('thumbnail-strip').classList.add('hidden');

        // 2. Hide Overlay (legacy cleanup)
        if (this.elements.cropOverlay) this.elements.cropOverlay.classList.add('hidden');

        // 3. Initialize Cropper
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
                background: rgba(20, 20, 20, 0.9);
                padding: 12px 24px;
                border-radius: 999px;
                border: 1px solid rgba(255, 255, 255, 0.1);
                backdrop-filter: blur(20px);
                box-shadow: 0 8px 32px rgba(0,0,0,0.4);
            `;

            toolbar.innerHTML = `
                <button id="cropper-cancel" style="color: #fff; background: transparent; border: none; font-size: 14px; cursor: pointer; padding: 8px 16px;">Cancel</button>
                <div style="width: 1px; background: rgba(255,255,255,0.2); margin: 4px 0;"></div>
                <button id="cropper-rotate-left" style="color: #fff; background: transparent; border: none; font-size: 18px; cursor: pointer; padding: 8px 12px;" title="Rotate Left">↺</button>
                <button id="cropper-rotate-right" style="color: #fff; background: transparent; border: none; font-size: 18px; cursor: pointer; padding: 8px 12px;" title="Rotate Right">↻</button>
                <div style="width: 1px; background: rgba(255,255,255,0.2); margin: 4px 0;"></div>
                <button id="cropper-save" style="color: #000; background: #fff; border: none; font-size: 14px; font-weight: 600; cursor: pointer; padding: 8px 24px; border-radius: 999px;">Save</button>
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
            const fileEntry = this.files[this.currentIndex];
            const fileData = await fileEntry.handle.getFile();

            const blob = await new Promise(r => canvas.toBlob(r, fileData.type || 'image/jpeg', 0.95));

            // Re-verify permission
            if (this.dirHandle) {
                await this.verifyPermission(this.dirHandle, true);
            } else {
                await this.verifyPermission(fileEntry.handle, true);
            }

            const writable = await fileEntry.handle.createWritable();
            await writable.write(blob);
            await writable.close();

            this.refreshThumbnailUI(this.currentIndex);
            if (fileEntry.fullImageUrl) URL.revokeObjectURL(fileEntry.fullImageUrl);
            const newFileData = await fileEntry.handle.getFile();
            const newUrl = URL.createObjectURL(newFileData);
            fileEntry.fullImageUrl = newUrl;

            // Exit crop mode first (destroys the cropper), then swap in the result.
            // cropper.replace() here would re-render the whole cropper just to destroy it.
            this.cancelCrop();
            this.elements.currentImage.src = newUrl;

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
