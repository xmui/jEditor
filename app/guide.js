// The guide: a place to look things up (take B, "cards with clips"). A sheet
// with the topics down the side, a search, and cards: each a little looping
// clip of what it does, a line of words and its keys as they're set now
// (Toolbar & keys can change them). Keyboard shortcuts lists every key.
// "Watch the tour again" starts the tour (tour.js).
//
// F1 from anywhere (Photos, Crop, Adjust, Paint, the home page), Guide in
// the home page's gear menu, or Help in a theme's menu bar. The words come
// from docs/using-jeditor.md. Every platform; a card for a feature only some
// have (Scan, Camera) shows where the app has it (Host.has).

const Guide = {
    isOpen: false,
    topic: 'start',
    query: '',

    TOPICS: [
        ['start', 'Start here'], ['photos', 'Photos'], ['crop', 'Crop'], ['flags', 'Flags'],
        ['files', 'Files and folders'], ['adjust', 'Adjust'], ['paint', 'Paint'], ['keys', 'Keyboard shortcuts']
    ],

    // [topics, clip, title, line, keys (action ids), the feature it needs]
    CARDS: [
        ['start files', 'folder', 'Open a folder', 'Open one on the home page, or drop it on the window. Subfolders come too.', []],
        ['start photos', 'turn', 'Turn a photo', 'Upright in one key. In the grid, every selected photo turns.', ['edit.rotateLeft', 'edit.rotateRight']],
        ['start crop', 'crop', 'Crop and straighten', 'Drag the corners or the dial. Enter saves.', ['edit.crop']],
        ['start flags', 'flag', 'Flag photos', 'Star the picks, mark the ones to scan again, add a colour.', ['flag.star', 'flag.rescan']],
        ['start adjust', 'light', 'Light and colour', 'Exposure, white balance, curves and looks, as in Lightroom.', ['edit.adjust']],
        ['start paint', 'brush', 'Paint on layers', 'Brush, fill, text and shapes, over the photo.', ['edit.paint']],
        ['start photos', 'find', 'Find anything', 'Type a command, a photo, a folder or a project, and Enter runs it. Each command shows its key.', ['app.palette']],
        ['photos', 'grid', 'One photo or the grid', 'The arrows move through the folder; this switches views.', ['view.toggle']],
        ['photos', 'undo', 'Undo anything', 'Turns, crops, renames, moves and deletes, even after you\'ve moved on.', ['edit.undo', 'edit.history']],
        ['photos files', 'rename', 'Rename', 'One photo, or every selected photo at once with a pattern.', ['edit.rename']],
        ['photos files', 'move', 'Move to a folder', 'Send the selection to a folder, or drag it onto one in the sidebar.', ['edit.moveTo']],
        ['photos', 'dupes', 'Find duplicates', 'Groups photos that look the same and suggests which to keep.', ['app.dupes']],
        ['crop', 'next', 'Crop many in a row', 'This saves the crop and opens the next photo.', ['crop.saveNext']],
        ['crop', 'auto', 'Auto crop scans', 'Right-click → Auto crop finds each print on a scan and makes it a photo.', []],
        ['crop', 'undo', 'Undo a crop', 'Any time, even after you\'ve moved on.', ['edit.undo']],
        ['flags', 'label', 'Colour labels', 'Red, yellow, green, blue and purple. The same key again takes it off.', ['flag.red']],
        ['flags', 'filter', 'Show only the flagged', 'Click a flag in the sidebar\'s Flags list; Ctrl+A then selects just those.', []],
        ['files', 'sidebar', 'The sidebar', 'The project\'s folders, your projects, pinned folders and drives.', ['folders.rail']],
        ['files', 'convert', 'Convert to save room', 'AVIF, WebP or JPEG XL, for some photos or a whole folder.', []],
        ['files', 'export', 'Export copies', 'At a size and in a format, with the edits.', []],
        ['files', 'scan', 'Scan', 'Straight into the project; each print on the glass becomes a photo.', [], 'scan'],
        ['files', 'camera', 'Shoot from the camera', 'Photos taken on a cable come straight into the project.', [], 'camera'],
        ['adjust', 'light', 'Open Adjust', 'Esc goes back to Photos, keeping what you did.', ['edit.adjust']],
        ['adjust', 'looks', 'Looks', 'Film looks under Basic: negative, slide, cinema, black and white.', []],
        ['adjust', 'before', 'Before and after', 'Before shows the photo as it was. Nothing is lost until you save.', []],
        ['adjust', 'copy', 'Copy and paste settings', 'Take one photo\'s look to the others.', []],
        ['paint', 'brush', 'Brushes', 'Brush, pencil, spray and eraser. [ and ] size the brush.', ['paint.brush']],
        ['paint', 'layers', 'Layers', 'Kept with the project, so the painting can be changed later.', []],
        ['paint', 'image', 'Bring in an image', 'Drag to move it, a corner to size it, Enter puts it down.', []],
        ['paint', 'canvas', 'A new canvas', 'New project on the home page: a size, a background and a folder.', []]
    ],

    esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); },
    kbd(text) { return `<kbd class="guide-k">${this.esc(text)}</kbd>`; },
    // An action's first key as keycaps, one for each key: Ctrl Z
    keycaps(id) {
        const k = app.keyBindings && app.keyBindings[id] && app.keyBindings[id][0];
        if (!k) return '';
        return app.formatCombo(k).split(' + ').map(p => this.kbd(p)).join('');
    },
    shown(card) { return !card[5] || Host.has(card[5]); },

    // The little looping pictures (style.css, .gclip)
    clip(kind) {
        const scene = '<i class="gc-scene"></i>';
        const parts = {
            folder: '<i class="gc-folder"></i><i class="gc-scene gc-fly"></i>',
            turn: '<i class="gc-scene gc-turn"></i>',
            crop: scene + '<i class="gc-cropbox"></i>',
            flag: scene + '<i class="gc-badge">★</i>',
            light: '<i class="gc-scene gc-bright"></i>',
            brush: scene + '<svg class="gc-stroke" viewBox="0 0 200 100" preserveAspectRatio="none"><path d="M18 74 C 60 22, 104 92, 182 30"/></svg>',
            grid: '<i class="gc-tiles">' + '<b></b>'.repeat(6) + '</i>',
            undo: '<i class="gc-scene gc-turnback"></i><i class="gc-badge gc-undo">↶</i>',
            rename: scene + '<i class="gc-name"><b>IMG_0412.jpg</b><b>Grandad 1974.jpg</b></i>',
            move: '<i class="gc-folder"></i><i class="gc-scene gc-fly"></i>',
            dupes: '<i class="gc-pair"><i class="gc-scene"></i><i class="gc-scene gc-gone"></i></i>',
            next: '<i class="gc-strip">' + '<b></b>'.repeat(4) + '</i>',
            auto: '<i class="gc-glass"><b></b><b></b></i>',
            label: scene + '<i class="gc-dot"></i>',
            filter: '<i class="gc-tiles gc-filter">' + '<b></b>'.repeat(6) + '</i>',
            sidebar: '<i class="gc-side"><b></b><b></b><b></b><b></b></i>',
            convert: '<i class="gc-file"><b>JPEG</b><b>AVIF</b></i><i class="gc-size"></i>',
            export: '<i class="gc-scene gc-shrink"></i>',
            scan: '<i class="gc-glass"><b></b><b></b></i>',
            camera: '<i class="gc-cam"></i><i class="gc-scene gc-drop"></i>',
            looks: '<i class="gc-scene gc-looks"></i>',
            before: '<i class="gc-scene gc-bright"></i><i class="gc-split"></i>',
            copy: '<i class="gc-pair"><i class="gc-scene gc-warm"></i><i class="gc-scene gc-catch"></i></i>',
            layers: '<i class="gc-layers"><b></b><b></b><b></b></i>',
            image: scene + '<i class="gc-pasted"></i>',
            canvas: '<i class="gc-blank"></i>',
            find: '<i class="gc-pal"><b class="gc-q">rot</b><b></b><b></b><b></b></i>'
        };
        return `<div class="gclip gclip-${kind}" aria-hidden="true">${parts[kind] || scene}</div>`;
    },

    toggle() { if (this.isOpen) this.close(); else this.open(); },

    open(topic) {
        if (topic) this.topic = topic;
        let box = document.getElementById('guide');
        if (!box) {
            box = document.createElement('div');
            box.id = 'guide';
            box.className = 'guide-scrim';
            box.innerHTML = `<div class="guide" role="dialog" aria-modal="true" aria-labelledby="guide-title">
                <nav class="guide-nav" aria-label="Topics"><h2 id="guide-title">Guide</h2>
                    <div class="guide-topics">${this.TOPICS.map(([id, name]) => `<button type="button" data-topic="${id}">${name}</button>`).join('')}</div>
                    <button type="button" class="guide-tour" data-tour><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg><span>Watch the tour again</span></button>
                </nav>
                <div class="guide-main">
                    <div class="guide-top"><label class="guide-search"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
                        <input id="guide-search" type="search" placeholder="Search the guide" aria-label="Search the guide" autocomplete="off"></label>
                        <button type="button" class="guide-x" title="Close (Esc)" aria-label="Close">×</button></div>
                    <div id="guide-list" class="guide-list"></div>
                </div></div>`;
            document.body.appendChild(box);
            box.addEventListener('click', (e) => {
                if (e.target === box || e.target.closest('.guide-x')) return this.close();
                const t = e.target.closest('[data-topic]');
                if (t) {
                    this.topic = t.dataset.topic;
                    this.query = '';
                    box.querySelector('#guide-search').value = '';
                    this.render();
                    return;
                }
                if (e.target.closest('[data-tour]')) {
                    this.close();
                    if (typeof Tour !== 'undefined') Tour.start();
                }
            });
            const q = box.querySelector('#guide-search');
            q.addEventListener('input', () => { this.query = q.value; this.render(); });
            box.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
            });
        }
        this.isOpen = true;
        this.render();
        setTimeout(() => document.getElementById('guide-search')?.focus(), 30);
    },

    close() {
        this.isOpen = false;
        this.query = '';
        document.getElementById('guide')?.remove();
    },

    render() {
        const box = document.getElementById('guide');
        if (!box) return;
        const q = this.query.trim().toLowerCase();
        const words = q.split(/\s+/).filter(Boolean);
        const hit = (text) => words.every(w => text.toLowerCase().includes(w));
        box.querySelectorAll('[data-topic]').forEach(b => b.setAttribute('aria-current', String(!q && b.dataset.topic === this.topic)));
        const cards = this.CARDS.filter(c => this.shown(c) && (q ? hit(`${c[2]} ${c[3]}`) : c[0].split(' ').includes(this.topic)));
        // The keys: all of them under Keyboard shortcuts, and those that match a search
        const keys = (q || this.topic === 'keys')
            ? (app.KEY_ACTIONS || []).filter(([id, , group, label]) => this.keycaps(id) && (!q || hit(`${group} ${label}`)))
            : [];
        let html = '';
        if (cards.length) {
            html += `<div class="guide-cards">${cards.map(([, kind, title, line, ids]) => {
                const k = ids.map(id => this.keycaps(id)).filter(Boolean);
                return `<article class="guide-card">${this.clip(kind)}<h3>${this.esc(title)}</h3><p>${this.esc(line)}</p>${k.length ? `<div class="guide-keys">${k.map(x => `<span>${x}</span>`).join('')}</div>` : ''}</article>`;
            }).join('')}</div>`;
        }
        if (keys.length) {
            let group = '';
            html += `<div class="guide-keylist">${q && cards.length ? '<h3>Keys</h3>' : ''}${keys.map(([id, , g, label]) => {
                const head = g !== group ? `<h4>${this.esc(g)}</h4>` : '';
                group = g;
                return `${head}<div class="guide-keyrow"><span>${this.esc(label)}</span><span class="guide-keycaps">${this.keycaps(id)}</span></div>`;
            }).join('')}</div>`;
        }
        box.querySelector('#guide-list').innerHTML = html || '<p class="guide-none">Nothing found. Try other words.</p>';
    }
};
