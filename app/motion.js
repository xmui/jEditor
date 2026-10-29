// Small motions in jEditor's own look (style.css, "Motion"): the mode
// switch's highlight glides to the mode chosen, rotate buttons turn their
// icon the way they turn the photo, the selection count ticks when it
// changes. They follow what happened and never hold anything up; the
// themes and Reduce motion have none (the CSS leaves them out).
const Motion = {
    init() {
        // The mode switch is made after this (modes.js), into the sidebar
        const rail = document.getElementById('folder-rail');
        const seg = () => {
            const el = document.getElementById('mode-seg');
            if (el && !el.querySelector(':scope > .seg-glide')) this.glide(el);
        };
        seg();
        if (rail) new MutationObserver(seg).observe(rail, { childList: true });
        // A rotate button: its arrow turns once, as the photo does
        document.addEventListener('click', (e) => {
            const b = e.target.closest('button[id*="rotate-left"], button[id*="rotate-right"]');
            if (b) this.replay(b, b.id.includes('left') ? 'turn-left' : 'turn-right');
        }, true);
        const count = document.getElementById('selection-count');
        if (count) {
            let last = count.textContent;
            new MutationObserver(() => {
                if (count.textContent !== last) this.replay(count, 'tick');
                last = count.textContent;
            }).observe(count, { childList: true, characterData: true, subtree: true });
        }
    },

    // Start a class's animation again, and take the class off when it ends
    replay(el, cls) {
        el.classList.remove(cls);
        void el.offsetWidth;
        el.classList.add(cls);
        el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
    },

    // One highlight behind a segmented switch, moved under the chosen button
    glide(seg) {
        if (!seg) return;
        const hl = document.createElement('span');
        hl.className = 'seg-glide';
        hl.setAttribute('aria-hidden', 'true');
        seg.prepend(hl);
        const place = () => {
            const on = seg.querySelector(':scope > button.on');
            hl.style.opacity = on ? '' : '0';
            if (!on) return;
            hl.style.left = on.offsetLeft + 'px';
            hl.style.top = on.offsetTop + 'px';
            hl.style.width = on.offsetWidth + 'px';
            hl.style.height = on.offsetHeight + 'px';
        };
        place();
        // Placed at once the first time, so it never slides in from the edge
        requestAnimationFrame(() => seg.classList.add('glides'));
        // Its buttons are made again for each mode (modes.js), which takes
        // the highlight out: put back, it moves from where it was
        new MutationObserver(() => {
            if (!hl.isConnected) seg.prepend(hl);
            place();
        }).observe(seg, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        new ResizeObserver(place).observe(seg);
    }
};

document.addEventListener('DOMContentLoaded', () => Motion.init());
