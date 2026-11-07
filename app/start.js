// The home page: Prints on a table. The last folders lie on it as stacks
// of prints (recents.js), and a photo opened on its own as one print
// called Recent; clicking one opens it in the grid. Under them, the main
// jobs as big tiles: Open a folder, Scan or Capture (Import while a
// camera's card is in, New canvas where there's no scanner or camera),
// Convert, Adjust a photo and Paint a photo. Top right, which jEditor
// this is ("Mac · 1.41.0") and Settings, with a dot when an update is
// ready, and a menu: Save edits when done, When jEditor opens.
//
// The web version also offers the app for the computer it's on:
// Windows, Mac or Linux get that download first (the others below it),
// an iPhone or iPad gets Add to Home Screen, an Android phone or tablet
// Install (Chrome's own prompt, or where to find it).

const Start = {
    RELEASES: 'https://github.com/xmui/jEditor/releases',
    NAMES: { windows: 'Windows', mac: 'Mac', linux: 'Linux', web: 'Web' },

    // The computer the web version is on: 'windows', 'mac', 'linux', 'ios',
    // 'android' or 'other' (an iPad says it's a Mac: it's the one with touch)
    device(nav = navigator) {
        const p = String((nav.userAgentData && nav.userAgentData.platform) || nav.platform || '');
        const ua = String(nav.userAgent || '');
        if (/iPhone|iPad|iPod/.test(ua) || (/Mac/.test(p) && nav.maxTouchPoints > 1)) return 'ios';
        if (/Android/i.test(ua)) return 'android';
        if (/Win/i.test(p)) return 'windows';
        if (/Mac/i.test(p)) return 'mac';
        if (/Linux|X11|CrOS/i.test(p + ' ' + ua)) return 'linux';
        return 'other';
    },

    // Each app's downloads, the first the one to suggest
    downloads(v) {
        const file = (name) => `${this.RELEASES}/latest/download/${name}`;
        return {
            windows: [
                { label: 'Download for Windows', note: 'Windows 10 and 11, no admin needed', href: file(`jEditor-Setup-${v}.exe`) },
                { label: 'Portable zip', href: file(`jEditor-${v}-portable.zip`) }
            ],
            mac: [
                { label: 'Download for Mac', note: 'Apple silicon and Intel, macOS 12 or later', href: file(`jEditor-${v}-mac.dmg`) },
                { label: 'Copy Homebrew command', copy: 'brew tap xmui/jeditor https://github.com/xmui/jEditor && brew install --cask jeditor' }
            ],
            linux: [
                { label: 'Download for Linux', note: 'AppImage, any 64-bit Linux', href: file(`jEditor-${v}-linux.AppImage`) },
                { label: '.deb', href: file(`jEditor-${v}-linux.deb`) },
                { label: 'Arch', href: file(`jEditor-${v}-linux.pacman`) }
            ]
        };
    },

    init() {
        const name = this.NAMES[Host.platform()] || 'Web';
        const badge = document.querySelector('#app-title .app-version');
        if (badge) {
            badge.textContent = `${name} · ${badge.textContent}`;
            badge.title = `jEditor for ${name === 'Web' ? 'the web' : name}, version ${typeof APP_VERSION !== 'undefined' ? APP_VERSION : ''}`;
        }
        if (Host.get()) return;
        // Chrome on Android offers to install the web version as an app:
        // kept, so the start screen can offer it at the right moment
        addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.installPrompt = e;
            if (this.device() === 'android') this.renderGet('android');
        });
        addEventListener('appinstalled', () => {
            this.installPrompt = null;
            if (this.device() === 'android') this.renderGet('android');
        });
        this.renderGet(this.device());
    },

    // The web version only: the app for this computer, then the others
    renderGet(device) {
        const box = document.getElementById('start-get');
        if (!box || typeof APP_VERSION === 'undefined') return;
        const all = this.downloads(APP_VERSION);
        box.textContent = '';
        const head = document.createElement('p');
        head.className = 'start-get-head';
        box.appendChild(head);
        const row = document.createElement('div');
        row.className = 'start-get-row';
        box.appendChild(row);
        const link = (d, primary) => {
            const a = document.createElement('a');
            a.className = primary ? 'btn primary' : 'btn secondary';
            a.href = d.href;
            a.rel = 'noopener';
            a.textContent = d.label;
            if (d.note) a.title = d.note;
            return a;
        };
        if (all[device]) {
            head.textContent = 'jEditor is also an app: no permission prompts, and it opens folders from your files.';
            const [main, ...more] = all[device];
            row.appendChild(link(main, true));
            for (const d of more) {
                if (d.copy) {
                    // A command for the Terminal: copied, not shown
                    const b = document.createElement('button');
                    b.className = 'btn secondary';
                    b.textContent = d.label;
                    b.title = d.copy;
                    b.dataset.copy = d.copy;
                    b.addEventListener('click', () => {
                        navigator.clipboard.writeText(d.copy).then(() => {
                            b.textContent = 'Copied: paste it in Terminal';
                            setTimeout(() => { b.textContent = d.label; }, 2500);
                        }, () => { b.textContent = d.copy; });
                    });
                    row.appendChild(b);
                } else {
                    row.appendChild(link(d, false));
                }
            }
        } else if (device === 'ios') {
            head.textContent = 'On iPhone and iPad: tap Share, then Add to Home Screen, to keep jEditor with your apps.';
        } else if (device === 'android') {
            if (this.installPrompt) {
                head.textContent = 'Keep jEditor with your apps: it opens full screen, like any other.';
                const b = document.createElement('button');
                b.className = 'btn primary';
                b.textContent = 'Install jEditor';
                b.addEventListener('click', async () => {
                    const prompt = this.installPrompt;
                    if (!prompt) return;
                    this.installPrompt = null;
                    prompt.prompt();
                    try { await prompt.userChoice; } catch (e) { /* closed */ }
                    this.renderGet('android');
                });
                row.appendChild(b);
            } else {
                head.textContent = 'On Android: in Chrome, tap ⋮, then Add to Home screen (or Install app), to keep jEditor with your apps.';
            }
        } else {
            head.textContent = 'jEditor is also an app for Windows, Mac and Linux.';
        }
        const others = document.createElement('p');
        others.className = 'start-get-others';
        const names = Object.keys(all).filter(k => k !== device);
        others.append(device in all ? 'Also for ' : 'Get it for ');
        names.forEach((k, i) => {
            if (i) others.append(i === names.length - 1 ? ' and ' : ', ');
            const a = document.createElement('a');
            a.href = all[k][0].href;
            a.rel = 'noopener';
            a.textContent = this.NAMES[k];
            others.appendChild(a);
        });
        others.append(' · ');
        const rel = document.createElement('a');
        rel.href = this.RELEASES;
        rel.target = '_blank';
        rel.rel = 'noopener';
        rel.textContent = 'All releases';
        others.appendChild(rel);
        box.appendChild(others);
        box.classList.remove('hidden');
    },

    // ---- The home page ----

    el(id) { return document.getElementById(id); },

    home(app) {
        this.app = app;
        const on = (id, fn) => { const b = this.el(id); if (b) b.addEventListener('click', fn); };
        on('btn-settings-start', (e) => { e.stopPropagation(); this.settingsMenu(e.currentTarget); });
        on('start-capture', (e) => { e.stopPropagation(); this.capture(e.currentTarget); });
        on('start-adjust', () => this.openPhoto('adjust'));
        on('start-paint', () => Modes.paintStart());
        on('home-all', () => this.places(true));
        on('home-places-x', () => this.places(false));
        const sheet = this.el('home-places');
        if (sheet) sheet.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.places(false); }
        });
        this.tiles();
        // When jEditor opens: the last project, or one picked
        setTimeout(() => this.reopen(), 0);
    },

    // All projects: the projects folder, pinned folders and drives (places.js)
    places(show) {
        const sheet = this.el('home-places');
        if (!sheet) return;
        sheet.classList.toggle('hidden', !show);
        if (show) {
            const first = sheet.querySelector('.sb-search, button, [tabindex]');
            if (first) first.focus({ preventScroll: true });
        } else {
            const all = this.el('home-all');
            if (all) all.focus({ preventScroll: true });
        }
    },

    // A camera's card plugged in (places.js), or taken out: null
    setCard(drive) {
        this.card = drive || null;
        this.tiles();
    },

    // An update is ready (updates.js): a dot on Settings, and Update in its menu
    setUpdate(r) {
        this.update = r && r.newer ? r : null;
        const dot = document.querySelector('#btn-settings-start .home-dot');
        if (dot) dot.classList.toggle('hidden', !this.update);
        const b = this.el('btn-settings-start');
        if (b) b.title = this.update ? `Settings · jEditor ${Updates.label(this.update.tag)} is available` : 'Settings';
    },

    // The second tile: Import while a card is in, else Scan or Capture
    // where there's a scanner or camera to use, else New canvas
    tiles() {
        const cap = this.el('start-capture');
        const blank = this.el('start-blank');
        if (!cap || !blank) return;
        const modeOn = (m) => typeof Modes === 'undefined' || !Modes.app || Modes.on(m);
        const hw = Host.has('scan') || Host.has('camera');
        const set = (name, sub, svg) => {
            cap.querySelector('.home-tile-name').textContent = name;
            cap.querySelector('.home-tile-sub').textContent = sub;
            cap.querySelector('svg').innerHTML = svg;
        };
        if (this.card) {
            set('Import', this.card.name, '<path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M9 3v4M12 3v4M15 3v4"/>');
            cap.title = `Import the photos on ${this.card.name}`;
        } else if (hw) {
            const both = Host.has('scan') && Host.has('camera');
            set(both ? 'Scan or Capture' : Host.has('scan') ? 'Scan' : 'Capture', both ? 'scanner or camera' : Host.has('scan') ? 'with a scanner' : 'with a camera',
                '<rect x="3" y="11" width="18" height="8" rx="2"/><path d="M6 11V5h12v6M7 15h4"/>');
            cap.title = 'Scan photos, or take them with a camera on a cable';
        }
        cap.classList.toggle('card', !!this.card);
        cap.classList.toggle('hidden', !this.card && !hw);
        blank.classList.toggle('hidden', !!this.card || hw || !modeOn('paint'));
        const adjust = this.el('start-adjust');
        if (adjust) adjust.classList.toggle('hidden', !modeOn('adjust'));
        const paint = this.el('start-paint');
        if (paint) {
            paint.classList.toggle('hidden', !modeOn('paint'));
            paint.querySelector('.home-tile-sub').textContent = blank.classList.contains('hidden') ? 'or a new canvas' : 'draw on a photo';
        }
    },

    capture(btn) {
        const app = this.app;
        if (this.card) { Import.open(this.card); return; }
        const scan = Host.has('scan'), cam = Host.has('camera');
        if (scan && cam) {
            const r = btn.getBoundingClientRect();
            app.openContextMenu([
                ['Scan…', () => Scan.open()],
                ['Capture with a camera…', () => Camera.open()]
            ], r.left, r.top - 6, { above: true });
        } else if (scan) Scan.open();
        else if (cam) Camera.open();
    },

    // Adjust a photo (or Paint's Open a file): one photo, opened on its
    // own in that mode. Where a browser can't give one file, a folder.
    async openPhoto(mode) {
        const app = this.app;
        if (typeof window.showOpenFilePicker === 'function') {
            let handle;
            try {
                [handle] = await window.showOpenFilePicker({
                    id: 'jeditor-' + mode,
                    types: [{ description: 'Images', accept: { 'image/*': ['.jpg', '.jpeg', '.png', '.webp', '.avif', '.jxl', '.tif', '.tiff'] } }]
                });
            } catch (e) {
                return; // cancelled
            }
            if (!handle) return;
            Modes.next = mode;
            await app.openFileHandles([handle]);
            return;
        }
        if (typeof Picked !== 'undefined' && Picked.available()) {
            Modes.next = mode;
            Picked.choose();
            return;
        }
        Modes.next = mode;
        app.browseFolder();
    },

    // ---- Settings, from the home page ----

    settingsMenu(btn) {
        const app = this.app;
        const p = app.uiPrefs;
        const opens = p.onOpen || 'home';
        const items = [];
        if (this.update) items.push([`Update to jEditor ${Updates.label(this.update.tag)}…`, () => Updates.offer(this.update)], ['—']);
        items.push(['Save edits when done', () => this.setDeferNew(!p.deferNew), false, !!p.deferNew]);
        items.push(['—'], ['When jEditor opens', null]);
        items.push(['This page', () => this.setOnOpen('home'), false, opens === 'home']);
        items.push(['The last project', () => this.setOnOpen('last'), false, opens === 'last']);
        items.push([opens === 'pick' && p.onOpenName ? `${p.onOpenName}…` : 'A project you pick…', () => this.pickProject(btn), false, opens === 'pick']);
        items.push(['—'], ['Settings…', () => app.toggleCustomizePanel(true)]);
        items.push(['Keyboard shortcuts', () => this.el('btn-shortcuts-start').click()]);
        items.push([this.el('btn-whatsnew-start').textContent, () => this.el('btn-whatsnew-start').click()]);
        const r = btn.getBoundingClientRect();
        app.openContextMenu(items, r.right - 260, r.bottom + 6);
    },

    // New projects keep their edits until saved (edits.js): each project
    // can still change it in its card
    setDeferNew(on) {
        const app = this.app;
        app.uiPrefs.deferNew = !!on;
        app.saveUiPrefs();
        const box = this.el('cust-defer-new');
        if (box) box.checked = !!on;
        app.showToast(on ? 'Projects opened from now on keep edits until you save them' : 'Projects opened from now on save edits straight away', 3000);
    },

    setOnOpen(how, rec = null) {
        const app = this.app;
        app.uiPrefs.onOpen = how;
        if (how === 'pick' && rec) { app.uiPrefs.onOpenId = rec.id; app.uiPrefs.onOpenName = rec.name; }
        if (how !== 'pick') { delete app.uiPrefs.onOpenId; delete app.uiPrefs.onOpenName; }
        app.saveUiPrefs();
        this.drawOnOpen();
    },

    // A project to open each time: one of the recent ones
    async pickProject(btn) {
        const list = await Recents.list();
        const r = btn.getBoundingClientRect();
        if (!list.length) { this.app.showToast('Open a project first: then it can be picked here', 3000); return; }
        this.app.openContextMenu(list.map(rec => [rec.name, () => this.setOnOpen('pick', rec), false, this.app.uiPrefs.onOpenId === rec.id]), r.right - 260, r.bottom + 6);
    },

    // Settings → Projects: When jEditor opens
    async drawOnOpen() {
        const sel = this.el('cust-on-open');
        if (!sel || !this.app) return;
        const p = this.app.uiPrefs;
        const list = await Recents.list().catch(() => []);
        sel.textContent = '';
        const add = (value, label) => { const o = document.createElement('option'); o.value = value; o.textContent = label; sel.appendChild(o); };
        add('home', 'This page');
        add('last', 'The last project');
        for (const rec of list) add('pick:' + rec.id, rec.name);
        if (p.onOpen === 'pick' && p.onOpenId && !list.some(r => r.id === p.onOpenId)) add('pick:' + p.onOpenId, p.onOpenName || 'A project');
        sel.value = p.onOpen === 'pick' ? 'pick:' + p.onOpenId : p.onOpen === 'last' ? 'last' : 'home';
    },

    async onOpenChanged(value) {
        if (value.startsWith('pick:')) {
            const id = value.slice(5);
            const rec = (await Recents.list()).find(r => r.id === id);
            this.setOnOpen('pick', rec || { id, name: this.app.uiPrefs.onOpenName });
        } else this.setOnOpen(value);
    },

    // jEditor has just opened: the last project, or the one picked, if it
    // can open without asking (a browser asks within a click: then this
    // page, and the project is on the table)
    async reopen() {
        const app = this.app;
        const p = app.uiPrefs;
        if (!p.onOpen || p.onOpen === 'home' || !Recents.supported()) return;
        const list = await Recents.list().catch(() => []);
        const rec = p.onOpen === 'pick' ? list.find(r => r.id === p.onOpenId) : list[0];
        if (!rec || !rec.handle) return;
        // Something else opened meanwhile (a folder given when starting)
        if (app.dirHandle || app.isLoading || app.files.length || app.elements.dropZone.classList.contains('hidden')) return;
        try {
            if (typeof rec.handle.queryPermission === 'function' && await rec.handle.queryPermission({ mode: 'readwrite' }) !== 'granted') return;
        } catch (e) {
            return;
        }
        if (app.dirHandle || app.isLoading) return;
        await Recents.open(rec);
    }
};
