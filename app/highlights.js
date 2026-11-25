// What's new in 2.0: seven cards, one at a time, over the app (the owner's
// pick A, mockup version 3). The six areas of 2.0 that are whole new, each
// with a picture of the real app and three lines, biggest first; then the
// rest in two rows, with See all for the whole list (the changelog's).
//
// Shown once, the first time a 2.x version opens after 1.x (script.js,
// checkForUpdateNotice), in place of the "Updated to" message. Never on a
// first run, which has the tour, and never in a theme, which gets the list
// as before. Help → What's new, the toolbar's What's new, Find anything and
// the home page's What's new open it again.
//
// Show me lights up where a card's things are, as one stop of the tour
// (Tour.spot), once a folder is open; the last card before And more offers
// the whole tour. ←, → and the dots move between cards; Esc closes.
//
// Every platform. The Photos library line is the Mac's, and the fonts line
// is where the computer's fonts can be listed (Host.has).

const Highlights = {
    i: 0,
    el: null,

    // The tour stops Show me uses: the mode switch's Adjust and Paint, and
    // Find anything, wherever the sidebar or the floating row has them
    MODE: (m) => [`#mode-seg [data-mode="${m}"]`, '#mode-chip-bar', '#mode-chip-float'],

    CARDS: [
        { kicker: 'The new look', art: 'fan', title: 'Welcome to jEditor 2.0', lines: () => [
            'A new look: glass and pills, and the photo never under them',
            'One top bar in every mode, and a docked sidebar',
            'Rounder, simpler menus, each showing its keys'] },
        { kicker: 'Paint', art: 'paint', title: 'Paint is a layers editor now', lines: () => [
            'Masks, groups, adjustment layers and filters as layers',
            Host.has('systemFonts') ? 'Text in any of your computer’s fonts; text and shapes stay editable' : 'Text and shapes stay editable',
            'Free transform and Warp, Heal and Clone, Symmetry'],
          spot: { mode: 'paint', title: 'Paint', text: () => '{key:edit.paint} opens Paint on the photo you’re on. The layers, their masks and groups are in its panel; Free transform, Warp and the filters are in its ⋯ menu.' + (Host.has('systemFonts') ? ' The Text tool lists your computer’s fonts, each in its own typeface.' : '') } },
        { kicker: 'Adjust', art: 'adjust', title: 'Adjust goes much further', lines: () => [
            'Looks you dial in, then keep as your own',
            'Texture, Clarity and Dehaze',
            'Perspective and lens fixes'],
          spot: { mode: 'adjust', title: 'Adjust', text: () => '{key:edit.adjust} opens Adjust on the photo you’re on. Looks are in Basic, Texture, Clarity and Dehaze in Presence, and perspective and lens fixes in Geometry.' } },
        { kicker: 'Old photos', art: 'old', title: 'Bring old prints back', lines: () => [
            'Restore color finds the fade and takes it off',
            'Scratches and creases: drag along one and it’s gone',
            'Descreen takes the dots off a magazine or newspaper scan'],
          spot: { mode: 'adjust', title: 'Old photos', text: () => 'Restore is the second tool under Adjust’s histogram: Restore color, dust, scratches and creases, and Descreen. In Photos, a photo’s right-click menu has Restore color too.' } },
        { kicker: 'Photos', art: 'photos', title: 'Find it, undo it, redo it', lines: () => [
            'Find anything: {key:app.palette} for commands, photos and folders',
            'Redo for every step, even a delete: {key:edit.redo}',
            Host.has('photosLibrary') ? 'iPhone photos show in seconds, and your Photos library is in the sidebar' : 'iPhone photos show in seconds, not minutes'],
          spot: { find: true, title: 'Find anything', text: () => '{key:app.palette}, then type a command, a photo or a folder and press Enter. {key:edit.undo} takes back any step, and {key:edit.redo} does it again.' } },
        { kicker: 'Start and save', art: 'save', title: 'A new start, and safer saving', tour: true, lines: () => [
            'A new Home, a short tour, and the guide on {key:app.guide}',
            'Edits are kept in jEditor, with a count of what’s unsaved; {key:edit.saveOver} writes them into the file',
            'A proper Export window'] },
        { kicker: 'And more', title: 'Everything else in 2.0', more: [
            // (how many: counted from the changelog's 2.0 lines, by kind)
            ['Big upgrades', 'Light mode, culling with {key:flag.star} and {key:flag.reject}, Full screen, the slideshow, Glass strength, QuickShape', 'big'],
            ['Polish and fixes', 'Plain words, calmer motion, smoother scrolling, sharper zoom', 'polish']] }
    ],

    // 2.0's lines in the changelog (changelog.js: each says what it is), of
    // one kind ('big', 'polish', 'card'), or all of them
    count(kind = null) {
        const entry = (typeof CHANGELOG !== 'undefined' ? CHANGELOG : []).find(e => e.kinds && e.kinds.some(Boolean));
        if (!entry) return 0;
        return kind ? entry.kinds.filter(k => k === kind).length : entry.items.length;
    },

    isOpen() { return !!this.el && !this.el.classList.contains('hidden'); },
    skin() { return !!document.documentElement.dataset.skin; },
    // A folder's open: Show me has something to light up
    canShow() { return !!(app.files && app.files.length) && !Tour.home(); },

    // The update to 2.x: once, after 1.x, not over the tour or in a theme
    firstTime(seen, now = APP_VERSION) {
        const major = (v) => parseInt(String(v), 10) || 0;
        return !!seen && major(now) >= 2 && major(seen) < 2 && !this.skin() && !Tour.running;
    },

    open(at = 0) {
        if (this.skin()) { app.toggleWhatsNew(true); return; }
        if (!this.el) this.build();
        if (!this.isOpen()) this._back = document.activeElement;
        this.el.classList.remove('hidden');
        this.go(at, true);
    },

    close() {
        if (!this.isOpen()) return;
        this.el.classList.add('hidden');
        const back = this._back;
        this._back = null;
        if (back && back.isConnected && back.focus) back.focus({ preventScroll: true });
    },

    build() {
        const el = document.createElement('div');
        el.id = 'highlights';
        el.className = 'dialog-overlay hl-overlay hidden';
        el.innerHTML = `<div class="hl-sheet" role="dialog" aria-modal="true" aria-labelledby="hl-title" tabindex="-1">
            <button type="button" class="hl-x" data-hl="close" title="Close (Esc)" aria-label="Close"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
            <div class="hl-card"></div>
            <div class="hl-foot"><div class="hl-dots" role="tablist" aria-label="Cards"></div><div class="hl-acts"></div></div>
        </div>`;
        el.addEventListener('mousedown', (e) => { if (e.target === el) this.close(); });
        el.addEventListener('click', (e) => {
            const b = e.target.closest('[data-hl]');
            if (!b) return;
            const act = b.dataset.hl;
            if (act === 'close') this.close();
            else if (act === 'next') this.go(this.i + 1);
            else if (act === 'dot') this.go(+b.dataset.i);
            else if (act === 'all') { this.close(); app.toggleWhatsNew(true); }
            else if (act === 'tour') { this.close(); Tour.start(); }
            else if (act === 'show') this.show(this.CARDS[this.i].spot);
        });
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.close();
            else if (e.key === 'ArrowRight' && !e.target.closest('input')) this.go(this.i + 1);
            else if (e.key === 'ArrowLeft' && !e.target.closest('input')) this.go(this.i - 1);
            else return;
            e.preventDefault();
            e.stopPropagation();
        });
        document.body.appendChild(el);
        this.el = el;
    },

    // The picture: the app as it looks now, light or dark
    art(c) {
        const t = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
        // (standalone.html has them in it: WHATSNEW_ART, from the build)
        const src = (n) => (typeof WHATSNEW_ART !== 'undefined' && WHATSNEW_ART[n]) || `whatsnew/${n}.webp`;
        const img = (n, cls = '') => `<img class="${cls}" src="${src(n)}" alt="" draggable="false">`;
        if (c.art === 'fan') return `<div class="hl-fan">${img(`fan-photos-${t}`)}${img(`fan-paint-${t}`)}${img(`fan-adjust-${t}`)}</div><span class="hl-big">2.0</span>`;
        if (c.art === 'old') return `<div class="hl-ba">${img('old', 'after')}<span class="hl-wipe">${img('old', 'before')}</span><span class="hl-bar"></span><em class="l">Faded</em><em class="r">Restored</em></div>`;
        return img(`${c.art}-${t}`, 'hl-pic');
    },

    go(i, focus = false) {
        if (!this.el) return;
        this.i = Math.max(0, Math.min(this.CARDS.length - 1, i));
        const c = this.CARDS[this.i], last = this.i === this.CARDS.length - 1;
        const w = (t) => Tour.words(t);
        const card = this.el.querySelector('.hl-card');
        card.innerHTML = c.more
            ? `<div class="hl-more"><span class="hl-kicker">${Tour.esc(c.kicker)}</span><h2 id="hl-title">${Tour.esc(c.title)}</h2><ul>${c.more.map(([h, t, kind]) => `<li><b>${Tour.esc(h)}</b><span>${w(t)}</span><i>${this.count(kind)}</i></li>`).join('')}</ul></div>`
            : `<div class="hl-art" aria-hidden="true">${this.art(c)}</div><div class="hl-body"><span class="hl-kicker">${Tour.esc(c.kicker)}</span><h2 id="hl-title">${Tour.esc(c.title)}</h2><ul>${c.lines().map(t => `<li>${w(t)}</li>`).join('')}</ul></div>`;
        // Without its pictures (the one-file version), the card goes on without
        card.querySelectorAll('img').forEach(im => im.addEventListener('error', () => card.querySelector('.hl-art')?.remove(), { once: true }));
        // The card coming in slides a little (not with Motion off)
        card.classList.remove('hl-in');
        if (document.documentElement.dataset.motion !== 'off') { void card.offsetWidth; card.classList.add('hl-in'); }
        this.el.querySelector('.hl-dots').innerHTML = this.CARDS.map((_, j) =>
            `<button type="button" role="tab" data-hl="dot" data-i="${j}" aria-label="Card ${j + 1} of ${this.CARDS.length}" aria-selected="${j === this.i}"></button>`).join('');
        const b = (act, label, primary) => `<button type="button" class="btn ${primary ? 'primary' : 'secondary'}" data-hl="${act}">${label}</button>`;
        let acts;
        if (this.i === 0) acts = b('close', 'Later') + b('next', 'Take a look', true);
        else if (last) acts = b('all', `See all ${this.count()} changes`) + b('close', 'Start', true);
        else acts = (c.tour ? b('tour', 'Take the tour') : c.spot && this.canShow() ? b('show', 'Show me') : '') + b('next', 'Next', true);
        this.el.querySelector('.hl-acts').innerHTML = acts;
        if (focus) this.el.querySelector('.hl-acts .primary')?.focus({ preventScroll: true });
        else if (!this.el.contains(document.activeElement)) this.el.querySelector('.hl-sheet').focus({ preventScroll: true });
    },

    // Show me: the pop-up goes and the tour lights up the place, one stop
    show(s) {
        if (!s) return;
        this.close();
        Tour.spot({
            id: 'whatsnew', view: 'here', side: s.find ? 'below' : 'right', title: s.title, text: s.text,
            target: s.find ? ['#mode-row-find', ...this.MODE('photos')] : this.MODE(s.mode)
        });
    }
};
