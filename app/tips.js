// Tooltips: one shared tip in jEditor's own look for every control's hint,
// in place of the system's plain one. The hints stay what they've always
// been, each control's title (in index.html or set from code), so nothing
// else changes: while a control is pointed at or has the keyboard's focus,
// its title is lifted off (no system tip) and shown here, and put back when
// the tip goes.
//
// - It waits a moment before the first tip; once one has shown, the next
//   comes almost at once, until the pointer rests off them for a while.
// - A key at the end of a hint, "Rotate left ([)", is shown quietly at the
//   right of the name, as the menus show theirs.
// - Below the control, above it near the bottom of the window or where
//   there's no room, beside it in a column of tools; never off the window.
//   On a big area (the photo, a panel) it sits under the pointer.
// - Gone while a button is held (dragging, a slider), while a menu is open,
//   on a key, a scroll or the wheel; on a touch screen there's none.
// - The control keeps its name for screen readers: a control with no other
//   name gets the hint as its aria-label while the title is lifted, and one
//   that has a name gets the tip as its description.
// - In a theme the system's tips stay, as that era's apps had them.
//
// Every platform.

const Tips = {
    DELAY: 550,     // ms before the first tip
    QUICK: 40,      // ms before the next, once one has shown
    WARM: 700,      // ms the quick start lasts after a tip goes
    GAP: 8,         // px between the control and the tip
    EDGE: 8,        // px kept clear of the window's edges

    el: null,       // the tip
    target: null,   // the control whose title is lifted
    text: '',       // its hint
    named: false,   // it got an aria-label from us (put back on leave)
    described: false,
    shown: false,
    held: false,    // a button is down
    quiet: false,   // pressed or keyed on this control: no tip till it's left
    byKeys: false,  // the target came by keyboard focus
    timer: 0,
    warmUntil: 0,
    x: 0, y: 0,     // the pointer

    init() {
        if (this._on) return;
        this._on = true;
        const d = document;
        d.addEventListener('pointerover', (e) => this.over(e), true);
        d.addEventListener('pointermove', (e) => { this.x = e.clientX; this.y = e.clientY; }, true);
        d.addEventListener('pointerdown', (e) => {
            this.held = true;
            this.hush(e.pointerType === 'touch');
        }, true);
        const up = () => { this.held = false; };
        d.addEventListener('pointerup', up, true);
        d.addEventListener('pointercancel', up, true);
        d.addEventListener('focusin', (e) => this.focus(e), true);
        d.addEventListener('focusout', (e) => { if (this.byKeys && e.target === this.target) this.leave(); }, true);
        d.addEventListener('keydown', (e) => { if (!/^(Shift|Control|Alt|Meta|Tab)$/.test(e.key)) this.hush(); }, true);
        d.addEventListener('wheel', () => this.hush(), { capture: true, passive: true });
        d.addEventListener('scroll', () => this.hush(), true);
        d.addEventListener('dragstart', () => this.hush(), true);
        window.addEventListener('blur', () => this.leave());
        window.addEventListener('resize', () => this.leave());
        // A hint changed while it's showing ("Hide" becomes "Show"): the
        // new one is lifted too, and the tip follows
        this.watch = new MutationObserver(() => {
            const t = this.target;
            if (!t) return;
            if (!t.isConnected) { this.leave(); return; }
            if (!t.hasAttribute('title')) return;
            this.text = t.getAttribute('title');
            t.removeAttribute('title');
            if (this.named) t.setAttribute('aria-label', this.text);
            if (!this.text.trim()) this.hide();
            else if (this.shown) this.fill();
        });
    },

    // The skin's own tips, and none on a touch screen
    off() { return !!document.documentElement.dataset.skin; },

    // A menu is open: its rows say what they do, and a tip would cover them
    menuOpen() { return !!document.getElementById('context-menu') || !!document.querySelector('.menu-bar.open'); },

    // What a pointer or focus lands on: the nearest control with a hint
    find(node) {
        const el = node && node.closest ? node.closest('[title]') : null;
        if (!el || el === document.documentElement || el === document.body) return null;
        if (el.tagName === 'OPTION' || el.closest('#tip')) return null;
        return el;
    },

    over(e) {
        if (e.pointerType === 'touch' || this.off()) return;
        const el = this.find(e.target);
        if (el && el !== this.target) { this.leave(); if (!this.held) this.arm(el, false); return; }
        // Off the control (its title is lifted, so find() sees past it)
        if (this.target && !el && !this.target.contains(e.target)) this.leave();
    },

    focus(e) {
        if (this.off()) return;
        // Only the keyboard's focus: a click's focus would show a tip under the pointer
        if (typeof UI !== 'undefined' && UI._pointer) return;
        const el = this.find(e.target);
        if (el !== e.target) return;
        this.leave();
        this.arm(el, true);
    },

    // The control's hint comes off it, and the tip is due
    arm(el, byKeys) {
        const text = el.getAttribute('title');
        if (!text || !text.trim()) return;
        // A name cut short shows the rest in its hint; one shown whole needs none
        if (text.trim() === el.textContent.trim() && el.scrollWidth <= el.clientWidth + 1) return;
        this.target = el;
        this.text = text;
        this.byKeys = byKeys;
        this.quiet = false;
        el.removeAttribute('title');
        // Its name, while the title's off
        const hasName = el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') || el.textContent.trim() ||
            (el.matches('input, select, textarea') && el.labels && el.labels.length);
        this.named = !hasName;
        if (this.named) el.setAttribute('aria-label', text);
        this.watch.observe(el, { attributes: true, attributeFilter: ['title'] });
        clearTimeout(this.timer);
        const wait = performance.now() < this.warmUntil ? this.QUICK : this.DELAY;
        this.timer = setTimeout(() => this.show(), wait);
    },

    // Pressed, keyed, scrolled: the tip goes, and stays gone on this control
    hush(all = false) {
        clearTimeout(this.timer);
        if (this.shown) this.warmUntil = 0;
        this.hide();
        this.quiet = !!this.target;
        if (all) this.leave();
    },

    // The pointer or focus has gone: the hint goes back on the control
    leave() {
        clearTimeout(this.timer);
        if (this.shown) this.warmUntil = performance.now() + this.WARM;
        this.hide();
        const t = this.target;
        this.target = null;
        if (!t) return;
        this.watch.disconnect();
        if (!t.hasAttribute('title')) t.setAttribute('title', this.text);
        if (this.named && t.getAttribute('aria-label') === this.text) t.removeAttribute('aria-label');
        this.named = false;
    },

    show() {
        const t = this.target;
        if (!t || this.quiet || this.held || this.off() || !t.isConnected || this.menuOpen()) return;
        if (!this.el) {
            this.el = document.createElement('div');
            this.el.id = 'tip';
            this.el.className = 'tip';
            this.el.setAttribute('role', 'tooltip');
            document.body.appendChild(this.el);
        }
        const quick = performance.now() < this.warmUntil;
        this.fill();
        this.el.classList.toggle('quick', quick);
        this.el.classList.add('on');
        this.shown = true;
        // A control with a name of its own gets the hint as its description
        if (!this.named && !t.hasAttribute('aria-describedby')) { t.setAttribute('aria-describedby', 'tip'); this.described = true; }
        this.place();
    },

    hide() {
        if (!this.shown) return;
        this.shown = false;
        this.el.classList.remove('on');
        const t = this.target;
        if (t && this.described && t.getAttribute('aria-describedby') === 'tip') t.removeAttribute('aria-describedby');
        this.described = false;
    },

    // "Rotate left ([)": the name, and its key quietly at the right
    split(text) {
        const m = /^(.*\S)\s+\(([^()]+)\)$/.exec(text.trim());
        if (!m) return [text.trim(), ''];
        const one = String.raw`(?:[⌃⌥⇧⌘]*(?:(?:Ctrl|Alt|Shift|Cmd|Option|Win)\+)*(?:F\d{1,2}|Esc|Enter|Return|Space|Tab|Delete|Backspace|Home|End|Page ?Up|Page ?Down|[←→↑↓]|[^\s()]))`;
        const keys = new RegExp(`^${one}(?:(?:\\s+or\\s+|\\s*,\\s*|\\s*/\\s*)${one})*$`);
        return keys.test(m[2]) ? [m[1], m[2]] : [text.trim(), ''];
    },

    fill() {
        const [name, key] = this.split(this.text);
        this.el.textContent = '';
        const n = document.createElement('span');
        n.className = 'tip-t';
        n.textContent = name;
        this.el.appendChild(n);
        if (key) {
            const k = document.createElement('span');
            k.className = 'tip-k';
            k.textContent = key;
            this.el.appendChild(k);
        }
        this.el.classList.toggle('long', name.length > 48);
        if (this.shown) this.place();
    },

    // A control in a tall, narrow strip (a column of tools)
    column(t) {
        let p = t.parentElement;
        for (let i = 0; p && i < 3; i++, p = p.parentElement) {
            const r = p.getBoundingClientRect();
            if (r.width >= 120) return false;
            if (r.height > r.width * 2.5) return true;
        }
        return false;
    },

    // Under the control, or over it in the lower part of the window (the
    // pills along the bottom: the tip goes toward the photo, not onto the
    // film strip) or where there's no room; inside the window. On a big
    // area, under the pointer, clear of the arrow
    place() {
        const t = this.target, tip = this.el;
        if (!t || !tip) return;
        const r = t.getBoundingClientRect();
        const vw = window.innerWidth, vh = window.innerHeight;
        const w = tip.offsetWidth, h = tip.offsetHeight;
        const big = r.height > 64 || r.width > 360;
        let x, y;
        if (!big && this.column(t)) {
            // In a column of tools (Paint's): beside it, not over the next one
            const right = r.left + r.width / 2 < vw / 2;
            x = right ? r.right + this.GAP : r.left - w - this.GAP;
            y = r.top + r.height / 2 - h / 2;
        } else if (big && !this.byKeys) {
            x = this.x - w / 2;
            y = this.y + 22;
            if (y + h > vh - this.EDGE) y = this.y - h - 10;
        } else {
            x = r.left + r.width / 2 - w / 2;
            const up = r.top > vh * 0.6 && r.top - h - this.GAP >= this.EDGE;
            y = up ? r.top - h - this.GAP : r.bottom + this.GAP;
            if (y + h > vh - this.EDGE) y = r.top - h - this.GAP;
        }
        x = Math.max(this.EDGE, Math.min(vw - w - this.EDGE, x));
        y = Math.max(this.EDGE, Math.min(vh - h - this.EDGE, y));
        tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
        tip.dataset.side = y < r.top ? 'above' : 'below';
    }
};

Tips.init();
