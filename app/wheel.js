// The wheel, the way a Mac does it. A Mac's trackpad sends a stream of
// small, exact scroll events (with momentum after the fingers lift), and a
// pinch as Ctrl+wheel; a mouse sends a notch at a time. Chrome on a Mac (and
// so the Mac app, which is Chromium) doesn't animate a mouse's notches the
// way Safari does, so a page jumps a notch at a time. Here:
//
//   kind(e)       'pinch', 'trackpad' or 'mouse', for the viewer and the grid
//                 to treat each as a Mac user expects (two fingers pan a
//                 zoomed photo, a pinch zooms it, a mouse's wheel zooms)
//   install()     a mouse's notches animated on whatever scrolls under the
//                 pointer (the grid, the folder list, the sidebar, Settings,
//                 Adjust's panel…), a short glide to where they add up to;
//                 the trackpad is left alone (it's smooth already), and so is
//                 anything that handles the wheel itself (zooming the photo).
//                 On a Mac only: elsewhere Chromium smooths them itself.
//   glide(el, axis, px)  the same glide, for the film strip (sideways)

const Wheel = {
    // Events closer together than this belong to one gesture (and its
    // momentum): they keep the kind its first event had
    GESTURE_MS: 120,

    kind(e) {
        if (e.ctrlKey) return 'pinch';
        const now = performance.now();
        if (this._last && now - this._last.t < this.GESTURE_MS) {
            this._last.t = now;
            return this._last.kind;
        }
        let kind;
        if (e.deltaMode !== 0) kind = 'mouse';                 // lines or pages: a wheel
        else if (e.deltaX) kind = 'trackpad';                  // sideways: fingers
        else if (typeof e.wheelDeltaY === 'number' && e.wheelDeltaY) {
            // Chromium: a trackpad's wheelDeltaY is exactly -3 × deltaY; a
            // mouse's comes in notches of 120
            kind = e.wheelDeltaY === -3 * e.deltaY ? 'trackpad' : e.wheelDeltaY % 120 === 0 ? 'mouse' : 'trackpad';
        } else {
            kind = Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50 ? 'mouse' : 'trackpad';
        }
        this._last = { t: now, kind };
        return kind;
    },

    // The wheel's movement in pixels (lines and pages turned into pixels)
    pixels(e, el) {
        const k = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? (el ? el.clientHeight : 800) : 1;
        return { x: e.deltaX * k, y: e.deltaY * k };
    },

    install() {
        if (this._installed) return;
        this._installed = true;
        // After everything else (bubbling to the document): a wheel handled
        // already (zoom, a slider nudged) is left alone
        document.addEventListener('wheel', (e) => {
            if (e.defaultPrevented || e.ctrlKey || e.shiftKey || !Host.mac()) return;
            if (this.kind(e) !== 'mouse') return;
            const dy = this.pixels(e).y;
            if (!dy) return;
            const el = this.scroller(e.target, dy);
            if (!el) return;
            e.preventDefault();
            this.glide(el, 'y', dy);
        }, { passive: false });
    },

    // The nearest element that scrolls up and down and can go further that
    // way (dy: which), or the page; null if none
    scroller(from, dy) {
        for (let el = from instanceof Element ? from : from && from.parentElement; el; el = el.parentElement) {
            const st = getComputedStyle(el);
            const scrolls = /(auto|scroll|overlay)/.test(st.overflowY) && el.scrollHeight > el.clientHeight + 1;
            if (scrolls) {
                const room = dy < 0 ? el.scrollTop > 0 : el.scrollTop < el.scrollHeight - el.clientHeight - 1;
                if (room) return el;
                if (st.overscrollBehaviorY === 'contain' || st.overscrollBehaviorY === 'none') return null;
            }
        }
        const page = document.scrollingElement;
        return page && page.scrollHeight > page.clientHeight + 1 ? page : null;
    },

    // Towards where the notches add up to, easing out (about 150 ms), from
    // wherever it's got to; scrolled some other way meanwhile (the
    // scrollbar, a key, the app keeping its place), it stops
    glide(el, axis, move) {
        const prop = axis === 'x' ? 'scrollLeft' : 'scrollTop';
        const max = axis === 'x' ? el.scrollWidth - el.clientWidth : el.scrollHeight - el.clientHeight;
        const g = el._glide && Math.abs(el[prop] - el._glide.set) <= 2 ? el._glide : { pos: el[prop] };
        g.target = Math.max(0, Math.min(max, (g.target !== undefined ? g.target : g.pos) + move));
        g.set = el[prop];
        el._glide = g;
        if (g.raf) return;
        let last = performance.now();
        const step = (now) => {
            g.raf = 0;
            if (el._glide !== g) return;
            // Moved by something else since the last frame: let it be
            if (Math.abs(el[prop] - g.set) > 2) { el._glide = null; return; }
            const dt = Math.min(64, now - last);
            last = now;
            g.pos += (g.target - g.pos) * (1 - Math.exp(-dt / 45));
            if (Math.abs(g.target - g.pos) < 0.5) g.pos = g.target;
            el[prop] = g.pos;
            g.set = el[prop];
            if (g.pos !== g.target) g.raf = requestAnimationFrame(step);
            else el._glide = null;
        };
        g.raf = requestAnimationFrame(step);
    }
};
