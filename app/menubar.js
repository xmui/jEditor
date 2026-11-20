// The menu bar in jEditor's own look: every command in one place, each
// with its key, so the keys can be found and nothing hides in an icon.
// Built from the command table (script.js KEY_ACTIONS): the names here,
// the keys as they're set now, and each runs what its key runs.
//
// Where it shows (Host.has('menuBar')):
//   - the Mac: the menu bar along the top of the screen, through the same
//     channel as a theme's menus (themes.js systemMenus, mac/main.js);
//   - Linux: the window's own menu bar, which shows while Alt is held;
//   - Windows: drawn in the page, a glass pill along the top that shows
//     when Alt is tapped (or F10), as Explorer's menu does, and goes when
//     a command is chosen, Esc is pressed or the photo is clicked.
// The web has none: Alt and F10 belong to the browser there.
//
// A command that can't run now (no project open, nothing selected) is
// there but greyed out, so the menus don't jump about. Adjust and Paint
// add their own menus while they're open.

const MenuBar = {
    // [label, a KEY_ACTIONS id, a function or a menu of its own, options]
    // or '—' (a line). Options: project, needs a project open; needs, a
    // feature (host.js); inPage, only in the menu bar the page draws;
    // native, run by the app itself in the system's menu bar, with its key
    // (key). An id is run in the context it belongs to, so Undo in Adjust
    // is Adjust's.
    MENUS: {
        File: [
            // (the Mac's ⌘O is the app's own: native)
            ['Open folder…', () => MenuBar.app.browseFolder(), { native: 'open', key: 'Ctrl+O' }],
            ['Import from a camera or card…', 'app.import'],
            ['Scan…', () => MenuBar.click('btn-scan'), { needs: 'scan', project: true }],
            ['Camera…', () => MenuBar.click('btn-camera'), { needs: 'camera', project: true }],
            '—',
            ['Write edits to file', 'edit.saveOver', { project: true }],
            ['Export…', () => Export.open({ files: MenuBar.app.selection.size ? [...MenuBar.app.selection] : null }), { project: true }],
            ['Convert…', 'app.convert', { project: true }]
        ],
        Edit: [
            ['Undo', 'edit.undo'],
            ['Redo', null],
            ['Undo history…', 'edit.history', { project: true }],
            '—',
            ['Copy image', 'edit.copyImage', { project: true }],
            ['Paste image', () => MenuBar.app.pasteFromMenu()],
            '—',
            ['Select all', 'edit.selectAll', { project: true }],
            '—',
            ['Find anything…', 'app.palette'],
            ['Settings…', 'app.settings', { inPage: true }]
        ],
        View: [
            ['Grid', 'view.grid', { project: true }],
            ['Single photo', 'view.single', { project: true }],
            '—',
            ['Sidebar', 'folders.rail', { project: true }],
            ['Info', 'view.info', { project: true }],
            ['Sort by', () => MenuBar.sortRows(), { project: true }],
            ['Rescan folder', 'app.refresh', { project: true }],
            '—',
            ['Zoom in', 'view.zoomIn', { project: true }],
            ['Zoom out', 'view.zoomOut', { project: true }],
            ['Zoom to fit', 'view.zoomFit', { project: true }],
            '—',
            ['Full screen', 'view.fullscreen'],
            ['Slideshow', 'view.slideshow', { project: true }]
        ],
        Photo: [
            ['Star', 'flag.star', { project: true }],
            ['Needs rescan', 'flag.rescan', { project: true }],
            ['Colour label', [
                ['Red', 'flag.red'], ['Yellow', 'flag.yellow'], ['Green', 'flag.green'], ['Blue', 'flag.blue'], ['Purple', 'flag.purple']
            ], { project: true }],
            ['Clear flags', 'flag.clear', { project: true }],
            '—',
            ['Rotate left', 'edit.rotateLeft', { project: true }],
            ['Rotate right', 'edit.rotateRight', { project: true }],
            ['Rotate 180°', 'edit.rotate180', { project: true }],
            ['Flip', [
                ['Left to right', 'edit.flipH'], ['Upside down', 'edit.flipV']
            ], { project: true }],
            ['Turn upright', 'edit.upright', { project: true }],
            '—',
            ['Crop and straighten', 'edit.crop', { project: true }],
            ['Auto crop', 'edit.autoCrop', { project: true }],
            ['Edit in Adjust', 'edit.adjust', { project: true }],
            ['Edit in Paint', 'edit.paint', { project: true }],
            '—',
            ['Rename…', 'edit.rename', { project: true }],
            ['Move to…', 'edit.moveTo', { project: true }],
            ['Copy to…', 'edit.copyTo', { project: true }],
            ['New folder', 'folders.new', { project: true }],
            '—',
            ['Find duplicates', 'app.dupes', { project: true }],
            '—',
            ['Delete', 'edit.trash', { project: true }]
        ],
        Adjust: [
            ['Auto', 'adjust.auto'],
            ['Auto color', 'adjust.autoColor'],
            ['White balance', 'adjust.whiteBalance'],
            '—',
            ['Before and after', 'adjust.before'],
            ['Show clipping', 'adjust.clip'],
            '—',
            ['Copy adjustments', 'adjust.copy'],
            ['Paste adjustments', 'adjust.paste'],
            ['Sync adjustments', 'adjust.sync'],
            ['Auto Sync', 'adjust.autoSync'],
            '—',
            ['Reset all', 'adjust.reset']
        ],
        Layer: [
            ['New layer', 'paint.newLayer'],
            ['Duplicate layer', 'paint.duplicate'],
            ['Bring in an image…', 'paint.import'],
            '—',
            ['Merge down', 'paint.merge'],
            ['Merge the layers shown', 'paint.mergeVisible'],
            '—',
            ['Group', 'paint.group'],
            ['Ungroup', 'paint.ungroup'],
            ['Clip to the layer below', 'paint.clip'],
            ['Lock transparency', 'paint.lockAlpha'],
            '—',
            ['Free transform', 'paint.transform']
        ],
        Select: [
            ['Select all', 'paint.selectAll'],
            ['Select nothing', 'paint.deselect'],
            ['Invert the selection', 'paint.invert'],
            '—',
            ['Delete what’s selected', 'paint.clear']
        ],
        Help: [
            ['Guide', 'app.guide'],
            ['Keyboard shortcuts', 'app.shortcuts'],
            ['Take the tour', 'app.tour'],
            '—',
            ['What’s new', () => MenuBar.click('btn-whatsnew')],
            ['Check for updates', () => MenuBar.checkUpdates(), { needs: 'updates' }]
        ]
    },

    // Which commands a context's own table has in place of Photos' ones
    // (Undo in Adjust is Adjust's undo)
    SWAP: {
        adjust: { 'edit.undo': 'adjust.undo', Redo: 'adjust.redo', 'edit.saveOver': 'adjust.saveOver', 'edit.copyImage': 'adjust.copyImage', 'edit.pasteImage': 'adjust.pasteImage', 'view.zoomIn': 'adjust.zoomIn', 'view.zoomOut': 'adjust.zoomOut', 'view.zoomFit': 'adjust.zoomFit' },
        paint: { 'edit.undo': 'paint.undo', Redo: 'paint.redo', 'edit.saveOver': 'paint.saveOver', 'edit.selectAll': 'paint.selectAll', 'view.zoomIn': 'paint.zoomIn', 'view.zoomOut': 'paint.zoomOut', 'view.zoomFit': 'paint.fit' },
        crop: { 'edit.undo': 'crop.undo', Redo: 'crop.redo', 'edit.selectAll': 'crop.selectAll', 'view.zoomIn': 'crop.zoomIn', 'view.zoomOut': 'crop.zoomOut', 'view.zoomFit': 'crop.zoomFit' }
    },

    init(app) {
        this.app = app;
        this.initSort();
        if (!Host.has('menuBar')) return;
        const native = Host.get();
        if (native && native.setMenus) {
            // The system's menu bar: kept up to date with what can run
            this.system();
            let t = 0;
            const mo = new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => this.system(), 150); });
            mo.observe(document.body, { attributes: true, attributeFilter: ['data-view', 'class'] });
            mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
            addEventListener('focus', () => this.system());
            const sel = document.getElementById('sort-mode');
            if (sel) sel.addEventListener('change', () => setTimeout(() => this.system()));
        } else this.inPage();
    },

    // The context the keys are in now (script.js handleKey)
    context() {
        const app = this.app, tool = app.cropState && app.cropState.tool;
        return app.cropState && app.cropState.active ? (tool === 'adjust' || tool === 'paint' ? tool : 'crop') : 'global';
    },

    // The menus now: Adjust's while Adjust is open, Layer and Select in
    // Paint; Photo only in Photos
    names() {
        const ctx = this.context();
        return ['File', 'Edit', 'View', ...(ctx === 'adjust' ? ['Adjust'] : ctx === 'paint' ? ['Layer', 'Select'] : ctx === 'global' ? ['Photo'] : []), 'Help'];
    },

    // A menu's commands: { label, run, key, enabled }, { label, items }
    // (a menu of its own) or '—'
    items(name, { inPage = false, rows = null } = {}) {
        const app = this.app, ctx = this.context();
        const swap = this.SWAP[ctx] || {};
        const handlers = app.keyHandlers();
        const out = [];
        for (const row of rows || this.MENUS[name] || []) {
            if (row === '—') { if (out.length && out[out.length - 1] !== '—') out.push('—'); continue; }
            const [label, act, o = {}] = row;
            if (o.needs && !Host.has(o.needs)) continue;
            if (o.inPage && !inPage) continue;
            if (Array.isArray(act) || (typeof act === 'function' && label === 'Sort by')) {
                const items = this.items(name, { inPage, rows: Array.isArray(act) ? act : act() });
                const enabled = (!o.project || !!app.dirHandle) && items.some(it => it.enabled);
                if (items.length) out.push({ label, items: enabled ? items : items.map(it => ({ ...it, enabled: false })), enabled });
                continue;
            }
            let id = typeof act === 'string' ? (swap[act] || act) : null;
            if (act === null) id = swap[label] || null; // Redo: only where there's one
            if (act === null && !id) continue;
            if (id && !app.actionOn(id)) continue; // an experiment that's off
            const run = typeof act === 'function' ? act : () => { const h = handlers[id]; if (h) h(); };
            const keys = id && app.keyBindings && app.keyBindings[id];
            const enabled = (!o.project || !!app.dirHandle) && (typeof act === 'function' || !!handlers[id]);
            const key = o.native ? (inPage ? '' : o.key) : keys && keys.length ? keys[0] : '';
            out.push({ label, run, id, key, enabled, native: o.native, checked: o.checked });
        }
        while (out[out.length - 1] === '—') out.pop();
        return out;
    },

    // ---- Sort (the folder pill's control, and View ▸ Sort by) ----
    // What to sort by, ticked, then which way, in words that fit it. The
    // <select> (#sort-mode) stays the one place the order is kept: the
    // Mac's toolbar reads it, and a change to it sorts.
    SORTS: [['name', 'Name', 'A to Z', 'Z to A'], ['taken', 'Date taken', 'Oldest first', 'Newest first'],
        ['date', 'Date modified', 'Oldest first', 'Newest first'], ['size', 'Size', 'Smallest first', 'Largest first']],

    sortRows() {
        const sel = document.getElementById('sort-mode');
        const [field, dir] = ((sel && sel.value) || 'name_asc').split('_');
        const set = (f, d) => () => {
            if (!sel || sel.value === `${f}_${d}`) return;
            sel.value = `${f}_${d}`;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        };
        // A field picked keeps the way it goes (names A to Z; dates and
        // sizes newest or largest first, as most look for)
        const first = (f) => (f === field ? dir : f === 'name' ? 'asc' : 'desc');
        const now = this.SORTS.find(s => s[0] === field) || this.SORTS[0];
        return [
            ...this.SORTS.map(([f, label]) => [label, set(f, first(f)), { checked: f === field }]),
            '—',
            [now[2], set(field, 'asc'), { checked: dir === 'asc' }],
            [now[3], set(field, 'desc'), { checked: dir === 'desc' }]
        ];
    },

    // The pill's Sort opens jEditor's menu, not the system's list
    initSort() {
        const sel = document.getElementById('sort-mode');
        if (!sel || sel._menu) return;
        sel._menu = true;
        const open = (e) => {
            e.preventDefault();
            const rows = this.sortRows().map(r => r === '—' ? ['—'] : [r[0], r[1], false, r[2].checked]);
            const box = (sel.closest('.sort-control') || sel).getBoundingClientRect();
            this.app.openContextMenu(rows, box.left, box.bottom + 6);
            const menu = document.getElementById('context-menu');
            if (menu) menu.setAttribute('aria-label', 'Sort by');
        };
        sel.addEventListener('mousedown', (e) => { if (e.button === 0) open(e); });
        sel.addEventListener('keydown', (e) => { if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) open(e); });
    },

    click(id) {
        const b = document.getElementById(id);
        if (b) b.click();
    },

    checkUpdates() {
        this.app.toggleCustomizePanel(true);
        if (this.app.showSettingsPage) this.app.showSettingsPage('updates');
        this.click('upd-check');
    },

    // ---- The Mac's menu bar (and Linux's) ----
    // Sent as a theme's menus are, with own: true; false when a theme has
    // the menu bar instead
    system() {
        const native = Host.get();
        if (!native || !native.setMenus || !this.app || !Host.has('menuBar')) return false;
        if (typeof Themes !== 'undefined' && Themes.current && Themes.current()) return false;
        const runs = new Map();
        const model = this.names().map(name => ({
            label: name,
            items: this.items(name).map(function one(it, i) {
                if (it === '—') return '—';
                const id = `own:${name}:${this}${i}`;
                if (it.items) return { label: it.label, enabled: it.enabled, items: it.items.map(one, id + '.') };
                runs.set(id, it.run);
                return { id, label: it.label, key: it.key, enabled: it.enabled, ...(it.native ? { native: it.native } : {}), ...(typeof it.checked === 'boolean' ? { checked: it.checked } : {}) };
            }, '')
        }));
        // Chosen there, it comes back through Themes.runMenu
        if (typeof Themes !== 'undefined') Themes._menuRuns = runs;
        const key = JSON.stringify(model);
        if (typeof Themes !== 'undefined' && key === Themes._menuKey) return true;
        if (typeof Themes !== 'undefined') Themes._menuKey = key;
        native.setMenus(model, { own: true });
        return true;
    },

    // ---- Windows: the menu bar in the page ----
    inPage() {
        const bar = this.bar = document.createElement('div');
        bar.id = 'menu-bar';
        bar.className = 'menu-bar hidden';
        bar.setAttribute('role', 'menubar');
        bar.setAttribute('aria-label', 'Menus');
        document.body.appendChild(bar);
        // Alt on its own, pressed and let go, shows it (as in Explorer);
        // Alt with anything else (Alt+Up, a drag) is left alone
        let alt = false;
        addEventListener('keydown', (e) => {
            if (e.key === 'Alt' && !e.repeat) { alt = !e.ctrlKey && !e.shiftKey && !e.metaKey; return; }
            alt = false;
            if (e.key === 'F10' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
                e.preventDefault();
                this.isOpen() ? this.close() : this.open();
            }
        }, true);
        addEventListener('keyup', (e) => {
            if (e.key !== 'Alt' || !alt) return;
            alt = false;
            e.preventDefault();
            this.isOpen() ? this.close() : this.open();
        }, true);
        addEventListener('pointerdown', (e) => {
            alt = false;
            if (this.isOpen() && !bar.contains(e.target) && !e.target.closest('#context-menu, .ctx-fly')) this.close();
        }, true);
        addEventListener('blur', () => { alt = false; });
        bar.addEventListener('keydown', (e) => this.key(e));
    },

    isOpen() {
        return !!this.bar && !this.bar.classList.contains('hidden');
    },

    // Shows the bar, the first menu's name focused
    open(name) {
        if (!this.bar) return;
        const bar = this.bar;
        bar.textContent = '';
        for (const n of this.names()) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'menu-bar-item';
            b.textContent = n;
            b.dataset.menu = n;
            b.setAttribute('role', 'menuitem');
            b.setAttribute('aria-haspopup', 'menu');
            b.setAttribute('aria-expanded', 'false');
            b.addEventListener('click', () => (b.getAttribute('aria-expanded') === 'true' ? this.closeMenu() : this.openMenu(n)));
            // With a menu open, pointing at another name opens that one
            b.addEventListener('pointerenter', () => { if (this.menuOpen() && this.openName !== n) this.openMenu(n); });
            bar.appendChild(b);
        }
        bar.classList.remove('hidden');
        const first = bar.querySelector(name ? `[data-menu="${name}"]` : '.menu-bar-item');
        if (first) first.focus({ preventScroll: true });
    },

    close() {
        if (!this.bar) return;
        this.closeMenu();
        this.bar.classList.add('hidden');
        this.openName = null;
        const a = document.activeElement;
        if (a && this.bar.contains(a)) a.blur();
    },

    menuOpen() {
        return !!this.openName && !!document.getElementById('context-menu');
    },

    // One menu, under its name
    openMenu(name) {
        const btn = this.bar.querySelector(`[data-menu="${name}"]`);
        if (!btn) return;
        const app = this.app;
        // The rows as the right-click menu has them (script.js fillMenu)
        const row = (it) => it === '—' ? ['—']
            : it.items ? [it.label, it.items.map(row), false, undefined, undefined, undefined, !it.enabled]
                : [it.label, () => { this.close(); it.run(); }, false, it.checked, it.id || undefined, undefined, !it.enabled];
        const rows = this.items(name, { inPage: true }).map(row);
        const r = btn.getBoundingClientRect();
        app.openContextMenu(rows, r.left, r.bottom + 6);
        const menu = document.getElementById('context-menu');
        if (!menu) return;
        menu.classList.add('menu-bar-menu');
        this.openName = name;
        for (const b of this.bar.querySelectorAll('.menu-bar-item')) b.setAttribute('aria-expanded', String(b === btn));
        // Left and right go to the next menu, as in any menu bar
        menu.addEventListener('keydown', (e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            if (e.target.closest('.ctx-more') && e.key === 'ArrowRight') return; // into its own menu
            e.preventDefault();
            e.stopPropagation();
            this.step(e.key === 'ArrowRight' ? 1 : -1, true);
        });
        // Esc in the menu: back to its name in the bar
        const watch = new MutationObserver(() => {
            if (document.getElementById('context-menu') === menu) return;
            watch.disconnect();
            if (this.openName === name) {
                this.openName = null;
                btn.setAttribute('aria-expanded', 'false');
                if (this.isOpen() && !document.activeElement.closest('#context-menu')) btn.focus({ preventScroll: true });
            }
        });
        watch.observe(document.body, { childList: true });
    },

    closeMenu() {
        if (this.menuOpen()) this.app.closeContextMenu();
        this.openName = null;
    },

    step(by, andOpen) {
        const items = [...this.bar.querySelectorAll('.menu-bar-item')];
        const at = items.findIndex(b => b.dataset.menu === this.openName || b === document.activeElement);
        const next = items[(Math.max(0, at) + by + items.length) % items.length];
        if (!next) return;
        if (andOpen) this.openMenu(next.dataset.menu);
        else next.focus({ preventScroll: true });
    },

    key(e) {
        if (!e.target.classList.contains('menu-bar-item')) return;
        const name = e.target.dataset.menu;
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); this.step(e.key === 'ArrowRight' ? 1 : -1, false); }
        else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.openMenu(name); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
        else if (e.key === 'Tab') this.close();
    }
};
