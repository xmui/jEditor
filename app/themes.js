// Themes (Settings → Appearance; PLAN.md item 8): jEditor as a native app
// of another time. One app, one layout; a theme is stylesheets over it
// (app/themes/), which can switch on a few parts: the docked layout
// (themes/docked.css: the floating bars along the window's edges, as
// desktop apps were laid out), its own title bar and a menu bar.
//
// Desktop only, by choice (feature 'themes': for now the Windows and Mac
// apps, whose title bar the theme draws), and an experiment for now (Settings →
// Experimental, on in betas). In a browser nothing here shows.
//
// A theme: { id, name, year, skin (data-skin on <html>, what its stylesheets
// are scoped to), layout, menus (the menu bar's, by name: MENUS), title
// ('windows': "Photo.jpg - jEditor", 'mac': just the name), variants:
// [{ id, name, mode (light or dark: tokens.css under it), css, swatch }],
// settings: [{ id, label, help, options: [[value, label]], default }] }.
// Chosen: uiPrefs.skin ('xp/royale'; '' for jEditor's own look), and each
// theme's settings in uiPrefs.skinSettings[theme][setting], shown as
// data-ts-<setting> on <html> for its stylesheets.

const Themes = {
    LIST: [
        {
            id: 'xp', name: 'Windows XP', year: 2005, skin: 'xp', layout: 'docked', title: 'windows',
            menus: ['File', 'Edit', 'View', 'Picture', 'Tools', 'Help'],
            variants: [
                { id: 'royale', name: 'Royale', mode: 'light', swatch: '#2a68dc', css: ['xp/luna.css', 'xp/office.css', 'xp/controls.css', 'xp/modes.css', 'xp/royale.css'] },
                { id: 'noir', name: 'Royale Noir', mode: 'light', swatch: '#3a3a3a', css: ['xp/luna.css', 'xp/office.css', 'xp/controls.css', 'xp/modes.css', 'xp/royale.css', 'xp/noir.css'] },
                { id: 'red', name: 'Royale Red', mode: 'light', swatch: '#c64242', css: ['xp/luna.css', 'xp/office.css', 'xp/controls.css', 'xp/modes.css', 'xp/royale.css', 'xp/red.css'] }
            ]
        },
        {
            id: 'snow', name: 'Snow Leopard', year: 2009, skin: 'snow', layout: 'docked', title: 'mac',
            // No menu bar in the window, as a Mac app has none: in the Mac's
            // own menu bar (systemMenus below), iPhoto's and Aperture's way
            systemMenus: ['File', 'Edit', 'View', 'Photos', 'Help'],
            variants: [
                { id: 'finder', name: 'Finder', mode: 'light', swatch: '#c9ced6', css: ['snow/finder.css', 'snow/controls.css', 'snow/modes.css'] },
                { id: 'aperture', name: 'Aperture', mode: 'dark', swatch: '#3a3a3a', css: ['snow/finder.css', 'snow/controls.css', 'snow/modes.css', 'snow/aperture.css'] }
            ]
        },
        {
            id: 'mac84', name: '1984', year: 1984, skin: 'mac84', layout: 'docked', title: 'mac',
            menus: ['File', 'Edit', 'View', 'Photo', 'Special'],
            variants: [
                { id: 'finder', name: 'Finder', mode: 'light', swatch: '#000000', css: ['mac84/finder.css', 'mac84/controls.css', 'mac84/modes.css'] }
            ],
            settings: [
                {
                    id: 'thumbs', label: 'Thumbnails', default: 'dither',
                    help: 'The photo you open is always in colour',
                    options: [['dither', 'One bit'], ['grey', 'Black and white'], ['colour', 'Colour']]
                }
            ]
        }
    ],

    // The menu bar's menus: [label, key action (script.js KEY_ACTIONS) or a
    // function, needs a project open]; '—' a line. Photo and Special are
    // 1984's names for Picture and Tools.
    MENUS: {
        File: [
            ['Open folder…', () => app.browseFolder()],
            ['Import from a camera or card…', 'app.import'],
            ['New folder', 'folders.new', true],
            '—',
            ['Export…', () => Export.open({ files: app.selection.size ? [...app.selection] : null }), true],
            ['Rename…', 'edit.rename', true],
            ['Move to…', 'edit.moveTo', true],
            ['Copy to…', 'edit.copyTo', true],
            ['Delete', 'edit.trash', true],
            '—',
            ['Close', () => Themes.window('close')]
        ],
        Edit: [
            ['Undo', 'edit.undo', true],
            ['Undo history', 'edit.history', true],
            '—',
            ['Select all', 'edit.selectAll', true],
            ['Copy adjustments', 'edit.copyAdjust', true],
            ['Paste adjustments', 'edit.pasteAdjust', true],
            '—',
            ['Search', 'app.search', true]
        ],
        View: [
            ['Photos', 'view.grid', true],
            ['One photo', 'view.single', true],
            '—',
            ['Folders', 'folders.rail', true],
            ['Info', 'view.info', true],
            '—',
            ['Zoom in', 'view.zoomIn', true],
            ['Zoom out', 'view.zoomOut', true],
            ['Zoom to fit', 'view.zoomFit', true],
            '—',
            ['Full screen', 'view.fullscreen'],
            ['Slideshow', 'view.slideshow', true]
        ],
        Picture: [
            ['Rotate left', 'edit.rotateLeft', true],
            ['Rotate right', 'edit.rotateRight', true],
            ['Rotate 180°', 'edit.rotate180', true],
            '—',
            ['Crop and straighten', 'edit.crop', true],
            ['Auto crop', 'edit.autoCrop', true],
            ['Adjust', 'edit.adjust', true],
            ['Paint', 'edit.paint', true],
            '—',
            ['Star', 'flag.star', true],
            ['Needs rescan', 'flag.rescan', true],
            ['Clear flags', 'flag.clear', true]
        ],
        Tools: [
            ['Find duplicates', 'app.dupes', true],
            ['Rescan folder', 'app.refresh', true],
            '—',
            ['Keyboard shortcuts', 'app.shortcuts'],
            ['Settings…', 'app.settings']
        ],
        Help: [
            ['Keyboard shortcuts', 'app.shortcuts'],
            ['What\'s new', () => app.toggleWhatsNew()]
        ]
    },

    applied: '', // 'xp/royale' when one is on

    init(app) {
        this.app = app;
        addEventListener('jeditor-experiments', () => { this.apply(); this.render(); });
        addEventListener('jeditor-window', (e) => {
            const bar = document.getElementById('th-titlebar');
            if (bar) bar.classList.toggle('maximized', !!(e.detail && e.detail.maximized));
        });
    },

    // Themes are offered: an app that has them, the experiment on
    can() {
        return typeof Host !== 'undefined' && Host.has('themes')
            && typeof Experiments !== 'undefined' && Experiments.on('themes');
    },

    // The chosen { theme, variant }, or null for jEditor's own look
    current() {
        const want = this.can() && this.app && this.app.uiPrefs && this.app.uiPrefs.skin;
        if (!want) return null;
        const [id, v] = String(want).split('/');
        const theme = this.LIST.find(t => t.id === id);
        if (!theme) return null;
        return { theme, variant: theme.variants.find(x => x.id === v) || theme.variants[0] };
    },

    // The chosen theme's light or dark (applyAppearance), or null
    mode() {
        const c = this.current();
        return c ? c.variant.mode : null;
    },

    setting(theme, s) {
        const kept = this.app.uiPrefs.skinSettings && this.app.uiPrefs.skinSettings[theme.id];
        const v = kept && kept[s.id];
        return s.options.some(o => o[0] === v) ? v : s.default;
    },

    // Settings → Appearance: a theme (and variant) chosen, or '' for none
    choose(key) {
        this.app.uiPrefs.skin = key || '';
        this.app.saveUiPrefs();
        this.apply();
        this.render();
    },

    set(themeId, settingId, value) {
        const p = this.app.uiPrefs;
        p.skinSettings = { ...(p.skinSettings || {}), [themeId]: { ...((p.skinSettings || {})[themeId] || {}), [settingId]: value } };
        this.app.saveUiPrefs();
        this.apply();
        this.render();
    },

    // Puts the chosen theme on (or takes one off): its stylesheets, the
    // attributes they're scoped to, its title bar and menu bar
    apply() {
        if (!this.app || !this.app.uiPrefs) return;
        const c = this.current();
        const root = document.documentElement;
        const key = c ? `${c.theme.id}/${c.variant.id}` : '';
        if (key !== this.applied) {
            this.off();
            this.applied = key;
            if (c) this.on(c);
            this.systemMenus(c && c.theme);
            this.app.applyAppearance();
            if (typeof Fit !== 'undefined') Fit.run();
        }
        // Its settings, each as data-ts-<id>
        for (const a of [...root.attributes]) if (a.name.startsWith('data-ts-')) root.removeAttribute(a.name);
        if (c) for (const s of c.theme.settings || []) root.setAttribute('data-ts-' + s.id, this.setting(c.theme, s));
        if (c && c.theme.id === 'mac84') Dither.start(); else Dither.stop();
        // Windows' own title bar, or the theme's: said once at the start
        // too, in case the page was reloaded with a theme taken off
        const native = Host.get();
        if (native && native.titleBar && this.ownTitleBar !== !!c) {
            this.ownTitleBar = !!c;
            native.titleBar(!!c);
        }
    },

    on({ theme, variant }) {
        const root = document.documentElement;
        const files = (theme.layout === 'docked' ? ['docked.css'] : []).concat(variant.css);
        // Hidden until its stylesheets are in, so jEditor's own look doesn't flash first
        root.classList.add('theme-loading');
        let left = files.length;
        const loaded = () => { if (--left <= 0) root.classList.remove('theme-loading'); };
        setTimeout(() => root.classList.remove('theme-loading'), 2000);
        for (const f of files) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'themes/' + f;
            link.dataset.theme = theme.id;
            link.onload = link.onerror = loaded;
            document.head.appendChild(link);
        }
        root.dataset.skin = theme.skin;
        root.dataset.layout = theme.layout || '';
        // The title bar and menu bar, along the top over everything
        const top = document.createElement('div');
        top.id = 'th-top';
        document.body.prepend(top);
        root.classList.add('th-top');
        this.titleBar(theme, top);
        this.menuBar(theme, top);
        this._topSize = new ResizeObserver(() => root.style.setProperty('--th-top', top.offsetHeight + 'px'));
        this._topSize.observe(top);
    },

    off() {
        const root = document.documentElement;
        document.querySelectorAll('link[data-theme]').forEach(l => l.remove());
        delete root.dataset.skin;
        delete root.dataset.layout;
        root.classList.remove('theme-loading', 'th-top');
        root.style.removeProperty('--th-top');
        const top = document.getElementById('th-top');
        if (top) top.remove();
        if (this._topSize) { this._topSize.disconnect(); this._topSize = null; }
        if (this._titleWatch) { this._titleWatch.disconnect(); this._titleWatch = null; }
    },

    // ---- The title bar: the app's icon, the name, the window's buttons ----

    titleBar(theme, top) {
        const bar = document.createElement('div');
        bar.id = 'th-titlebar';
        bar.innerHTML = '<span class="th-grip"></span><span class="th-appicon"></span><span class="th-title"></span>'
            + '<span class="th-caps"><button type="button" class="th-min" aria-label="Minimise"></button>'
            + '<button type="button" class="th-max" aria-label="Maximise"></button>'
            + '<button type="button" class="th-close" aria-label="Close"></button></span>';
        bar.querySelector('.th-min').addEventListener('click', () => this.window('minimize'));
        bar.querySelector('.th-max').addEventListener('click', () => this.window('maximize'));
        bar.querySelector('.th-close').addEventListener('click', () => this.window('close'));
        // The top edge still resizes the window
        bar.querySelector('.th-grip').addEventListener('pointerdown', (e) => {
            if (e.button === 0) this.window('resizeTop');
        });
        top.appendChild(bar);
        const sync = () => {
            bar.querySelector('.th-title').textContent = this.title(theme);
            this.facts();
            this.systemMenus(theme); // (what needs a project, once there is one)
        };
        sync();
        // What's shown changes the name and the counts: the view, the
        // photo, the folder, the selection
        const mo = this._titleWatch = new MutationObserver(sync);
        mo.observe(document.body, { attributes: true, attributeFilter: ['data-view'] });
        for (const id of ['file-name-text', 'fb-crumbs', 'file-count', 'selection-count']) {
            const el = document.getElementById(id);
            if (el) mo.observe(el, { childList: true, characterData: true, subtree: true });
        }
    },

    // What a theme's stylesheets can write in, as attributes (attr()):
    // the folder's name, how many photos and their size, how many selected
    facts() {
        const app = this.app;
        const set = (id, key, value) => {
            const el = document.getElementById(id);
            if (el && el.getAttribute(key) !== value) el.setAttribute(key, value);
        };
        const scope = typeof Folders !== 'undefined' && Folders.scope;
        set('fb-crumbs', 'data-folder', scope ? scope.split('/').pop() : app.dirHandle ? app.dirHandle.name : '');
        const files = app.dirHandle ? app.viewFiles() : [];
        const n = files.length;
        const items = `${n.toLocaleString()} item${n === 1 ? '' : 's'}`;
        const kb = Math.round(files.reduce((t, f) => t + (f.size || 0), 0) / 1024);
        set('fb-crumbs', 'data-items', items);
        set('folder-bar', 'data-info', `${items}\u2003\u2003${kb.toLocaleString()}K in folder`);
        set('btn-clear-selection', 'data-total', n.toLocaleString());
        set('selection-count', 'data-n', app.selection.size.toLocaleString());
    },

    title(theme) {
        const app = this.app;
        const single = document.body.dataset.view === 'single' && app.currentFile;
        const scope = typeof Folders !== 'undefined' && Folders.scope;
        const name = single ? app.currentFile.name
            : scope ? scope.split('/').pop()
            : app.dirHandle ? app.dirHandle.name : '';
        if (theme.title === 'windows') return name ? `${name} - jEditor` : 'jEditor';
        return name || 'jEditor';
    },

    window(action) {
        const native = Host.get();
        if (native && native.windowAction) native.windowAction(action);
        else if (action === 'close') window.close();
    },

    // ---- The menu bar: jEditor's commands, by menu ----

    menuBar(theme, top) {
        if (!theme.menus) return;
        const bar = document.createElement('div');
        bar.id = 'th-menubar';
        bar.setAttribute('role', 'menubar');
        for (const name of theme.menus) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'th-menu';
            b.textContent = name;
            b.setAttribute('aria-haspopup', 'menu');
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                if (b.classList.contains('open')) this.app.closeContextMenu();
                else this.openMenu(b, name);
            });
            // Once one is open, the others open as the pointer passes
            b.addEventListener('pointerenter', () => {
                const open = bar.querySelector('.th-menu.open');
                if (open && open !== b) this.openMenu(b, name);
            });
            bar.appendChild(b);
        }
        top.appendChild(bar);
    },

    // [label, run, , key as shown, key as bound, can run now]. all: the ones
    // needing a project too, there but not to be run (the Mac's menu bar)
    menuItems(name, { all = false } = {}) {
        const app = this.app;
        const list = name === 'Photos' ? [...this.MENUS.Picture, '—', ...this.MENUS.Tools.slice(0, 2)]
            : this.MENUS[name === 'Photo' ? 'Picture' : name === 'Special' ? 'Tools' : name] || [];
        const handlers = app.keyHandlers();
        const out = [];
        for (const item of list) {
            if (item === '—') { out.push(['—']); continue; }
            const [label, act, needsProject] = item;
            if (needsProject && !app.dirHandle && !all) continue;
            const run = typeof act === 'function' ? act : () => handlers[act] && handlers[act]();
            const keys = typeof act === 'string' && app.keyBindings && app.keyBindings[act];
            out.push([label, run, false, keys && keys.length ? Host.keys(keys[0]) : '', keys && keys.length ? keys[0] : '', !needsProject || !!app.dirHandle]);
        }
        return out;
    },

    // ---- The Mac's own menu bar ----
    // While a theme is on, the menu bar along the top of the Mac's screen
    // has jEditor's commands by the theme's menus (Snow Leopard's, which has
    // none in the window, by its systemMenus), each with its key; jEditor's
    // own look keeps the app's usual menus (mac/main.js)
    systemMenus(theme) {
        const native = Host.get();
        if (!native || !native.setMenus) return;
        const names = theme && (theme.systemMenus || theme.menus);
        if (!names) {
            if (this._menuKey) { this._menuKey = ''; native.setMenus(null); }
            return;
        }
        const runs = new Map();
        const model = names.map(name => ({
            label: name,
            items: this.menuItems(name, { all: true }).map((it, i) => {
                if (it[0] === '—') return '—';
                const id = `${name}:${i}`;
                runs.set(id, it[1]);
                return { id, label: it[0], key: it[4], enabled: it[5] };
            })
        }));
        this._menuRuns = runs;
        const key = JSON.stringify(model);
        if (key === this._menuKey) return;
        this._menuKey = key;
        native.setMenus(model);
    },

    // A command chosen in the Mac's menu bar
    runMenu(id) {
        const run = this._menuRuns && this._menuRuns.get(id);
        if (run) run();
    },

    openMenu(button, name) {
        const app = this.app;
        const items = this.menuItems(name);
        const r = button.getBoundingClientRect();
        app.openContextMenu(items, r.left, r.bottom);
        const menu = document.getElementById('context-menu');
        if (!menu) return;
        menu.classList.add('th-dropdown');
        // Each command's key, at the right
        const buttons = [...menu.querySelectorAll('button[role="menuitem"]')];
        items.filter(i => i[0] !== '—').forEach((item, i) => {
            if (!item[3] || !buttons[i]) return;
            const k = document.createElement('span');
            k.className = 'ctx-key';
            k.textContent = item[3];
            buttons[i].appendChild(k);
        });
        document.querySelectorAll('#th-menubar .th-menu.open').forEach(b => b.classList.remove('open'));
        button.classList.add('open');
        // Open until the menu goes (a click, Esc, another menu)
        const mo = new MutationObserver(() => {
            if (menu.isConnected) return;
            mo.disconnect();
            button.classList.remove('open');
        });
        mo.observe(document.body, { childList: true });
    },

    // ---- Settings → Appearance: the gallery ----

    render() {
        const box = document.getElementById('set-themes');
        if (!box) return;
        const can = this.can();
        const chosen = this.current();
        for (const el of document.querySelectorAll('.set-themes-part')) el.classList.toggle('hidden', !can);
        // Light or dark: decided by a theme, when one's on
        const name = document.getElementById('set-theme-name');
        if (name) name.textContent = can ? 'Light or dark' : 'Theme';
        const row = document.getElementById('set-theme-row');
        if (row) row.classList.toggle('unavailable', !!chosen);
        if (row) row.querySelectorAll('input').forEach(i => { i.disabled = !!chosen; });
        const decided = document.getElementById('set-theme-decided');
        if (decided) decided.classList.toggle('hidden', !chosen);
        if (!can) return;
        box.textContent = '';
        const card = (key, name, sub, swatches, active) => {
            const b = document.createElement('div');
            b.className = 'theme-card' + (active ? ' active' : '');
            b.setAttribute('role', 'radio');
            b.setAttribute('aria-checked', String(active));
            b.tabIndex = 0;
            b.dataset.skin = key;
            const shot = document.createElement('span');
            shot.className = 'theme-shot';
            shot.style.backgroundImage = key ? `url(themes/${key.split('/')[0]}/preview-${key.split('/')[1]}.jpg)` : 'url(themes/preview-jeditor.jpg)';
            const label = document.createElement('span');
            label.className = 'theme-name';
            label.textContent = name;
            const small = document.createElement('small');
            small.textContent = sub;
            label.appendChild(small);
            b.append(shot, label);
            if (swatches) b.appendChild(swatches);
            const pick = () => this.choose(key);
            b.addEventListener('click', (e) => { if (!e.target.closest('.theme-dot')) pick(); });
            b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
            return b;
        };
        box.appendChild(card('', 'jEditor', 'Today\'s look', null, !chosen));
        for (const t of this.LIST) {
            const on = !!chosen && chosen.theme === t;
            const v = on ? chosen.variant : t.variants[0];
            let dots = null;
            if (t.variants.length > 1) {
                dots = document.createElement('span');
                dots.className = 'theme-dots';
                for (const x of t.variants) {
                    const d = document.createElement('button');
                    d.type = 'button';
                    d.className = 'theme-dot' + (x === v ? ' active' : '');
                    d.style.setProperty('--sw', x.swatch);
                    d.title = d.ariaLabel = x.name;
                    d.addEventListener('click', () => this.choose(`${t.id}/${x.id}`));
                    dots.appendChild(d);
                }
            }
            const b = card(`${t.id}/${v.id}`, t.name, `${v.name} · ${t.year}`, dots, on);
            box.appendChild(b);
        }
        // The chosen theme's own settings, under the gallery
        const own = document.getElementById('set-theme-settings');
        own.textContent = '';
        for (const s of (chosen && chosen.theme.settings) || []) {
            const row = document.createElement('div');
            row.className = 'set-row';
            const label = document.createElement('span');
            label.className = 'set-label';
            label.id = 'set-ts-' + s.id;
            label.textContent = s.label;
            if (s.help) { const h = document.createElement('small'); h.textContent = s.help; label.appendChild(h); }
            const seg = document.createElement('div');
            seg.className = 'seg';
            seg.setAttribute('role', 'radiogroup');
            seg.setAttribute('aria-labelledby', label.id);
            const value = this.setting(chosen.theme, s);
            for (const [v, text] of s.options) {
                const l = document.createElement('label');
                l.innerHTML = `<input type="radio" name="set-ts-${s.id}" value="${v}"><span></span>`;
                l.querySelector('span').textContent = text;
                const input = l.querySelector('input');
                input.checked = v === value;
                input.addEventListener('change', () => this.set(chosen.theme.id, s.id, v));
                seg.appendChild(l);
            }
            row.append(label, seg);
            own.appendChild(row);
        }
    }
};

// 1984's thumbnails: one bit, dithered the MacPaint way (Atkinson), at the
// size each is shown. Only the grid's and the film strip's; the photo
// opened stays in colour. data-ts-thumbs says which (themes.js settings).
const Dither = {
    start() {
        if (this.mo) { this.soon(true); return; }
        // New thumbnails; tiles resized (the size slider sets a style)
        this.mo = new MutationObserver((list) => this.soon(list.some(m => m.attributeName === 'style')));
        this.mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'style'] });
        this.onLoad = (e) => { if (e.target && e.target.tagName === 'IMG') this.soon(); };
        this.onResize = () => this.soon(true);
        document.addEventListener('load', this.onLoad, true);
        addEventListener('resize', this.onResize);
        this.soon(true);
    },

    stop() {
        if (!this.mo) return;
        this.mo.disconnect();
        this.mo = null;
        document.removeEventListener('load', this.onLoad, true);
        removeEventListener('resize', this.onResize);
        this.undo();
    },

    // Back to the photos' own thumbnails
    undo() {
        document.querySelectorAll('img[data-undithered]').forEach(im => {
            im.src = im.dataset.undithered;
            delete im.dataset.undithered;
            delete im.dataset.ditherSize;
        });
    },

    // Once a frame; sizes: check the ones done for a new size too
    soon(sizes) {
        if (sizes) this.sizes = true;
        if (this.queued) return;
        this.queued = true;
        requestAnimationFrame(() => {
            this.queued = false;
            const all = this.sizes;
            this.sizes = false;
            this.run(all);
        });
    },

    inner(im) {
        const cs = getComputedStyle(im);
        return [Math.floor(im.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)),
            Math.floor(im.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom))];
    },

    run(sizes) {
        if (document.documentElement.dataset.tsThumbs !== 'dither') { this.undo(); return; }
        for (const im of document.querySelectorAll('#grid-view .grid-item img, #thumbnail-strip .thumb-item img, #mode-strip .mode-thumb img')) {
            const done = im.dataset.undithered && im.src.startsWith('data:');
            if (done) {
                // Shown at a new size: again, from its own thumbnail
                if (sizes && this.inner(im).join('x') !== im.dataset.ditherSize) im.src = im.dataset.undithered;
                continue;
            }
            if (!im.complete || !im.naturalWidth || im.src.startsWith('data:')) continue;
            const [w, h] = this.inner(im);
            if (w < 8 || h < 8) continue;
            const src = im.src;
            try {
                const out = this.atkinson(im, w, h);
                im.dataset.undithered = src;
                im.dataset.ditherSize = `${w}x${h}`;
                im.src = out;
            } catch (e) { /* a picture the canvas can't read: left as it is */ }
        }
    },

    atkinson(img, w, h) {
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const g = c.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, w, h);
        const r = Math.min(w / img.naturalWidth, h / img.naturalHeight);
        const dw = Math.round(img.naturalWidth * r), dh = Math.round(img.naturalHeight * r);
        const ox = Math.floor((w - dw) / 2), oy = Math.floor((h - dh) / 2);
        g.drawImage(img, ox, oy, dw, dh);
        const d = g.getImageData(0, 0, w, h), p = d.data, L = new Float32Array(w * h);
        for (let i = 0; i < w * h; i++) {
            const y = (0.299 * p[i * 4] + 0.587 * p[i * 4 + 1] + 0.114 * p[i * 4 + 2]) / 255;
            L[i] = Math.min(1, Math.max(0, (Math.pow(y, 0.85) - 0.5) * 1.15 + 0.5)) * 255;
        }
        const inside = (x, y) => x >= ox && x < ox + dw && y >= oy && y < oy + dh;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const i = y * w + x;
            if (!inside(x, y)) { L[i] = 255; continue; }
            const o = L[i], n = o < 128 ? 0 : 255, e = (o - n) / 8;
            L[i] = n;
            for (const [dx, dy] of [[1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [0, 2]]) {
                const X = x + dx, Y = y + dy;
                if (X >= ox && X < ox + dw && Y < oy + dh) L[Y * w + X] += e;
            }
        }
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const i = y * w + x, v = L[i] >= 128 ? 255 : 0;
            p[i * 4] = p[i * 4 + 1] = p[i * 4 + 2] = v;
            p[i * 4 + 3] = inside(x, y) ? 255 : 0;
        }
        g.putImageData(d, 0, 0);
        // a one-pixel frame round the picture
        g.strokeStyle = '#000';
        g.lineWidth = 1;
        g.strokeRect(ox + 0.5, oy + 0.5, dw - 1, dh - 1);
        return c.toDataURL();
    }
};
