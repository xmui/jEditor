// Liquid glass (Settings → Glass → Liquid): the glass bends what's under
// its edges, as Apple's Liquid Glass does. The only glass that bends;
// tokens.css has its look (the rim, the sheen, how dark), this the bend.
//
// Each glass part gets an SVG filter made for its size and shape: a
// displacement map that's flat in the middle and, near the edge, moves
// what's under it in from the edge, more the closer to it, as light
// through a rounded rim would. style.css puts the filter in front of the
// glass's blur (--lg-bend). One map per size and shape, shared by the
// parts that have it, and made again only when a part changes size.
//
// Only where it can be drawn: Chromium draws an SVG filter behind an
// element (the Windows app's WebView2, the Mac and Linux apps' Electron,
// Chrome and Edge); Safari and Firefox get the same glass, unbent. Off
// with a theme on, and when the system asks for less transparency or more
// contrast (the glass is solid then, tokens.css).

const Liquid = {
    SELECTOR: '.toolbar, .file-info, .folder-rail, #context-menu, .task-pill, .toast, .picked-bar',
    KEEP: 24, // maps kept for sizes no part has now (a message that comes back)

    on: false,
    maps: new Map(), // key → { id, users }
    parts: new Map(), // element → key
    seq: 0,

    init() {
        if (this.started) return;
        this.started = true;
        // Whether the browser draws an SVG filter behind an element: only
        // Chromium does, and only Chromium knows app-region
        this.can = !!(window.CSS && CSS.supports('backdrop-filter', 'url(#a)') && CSS.supports('-webkit-app-region', 'drag'));
        if (!this.can) return;
        const root = document.documentElement;
        new MutationObserver(() => this.apply()).observe(root, { attributes: true, attributeFilter: ['data-glass', 'data-skin'] });
        for (const q of ['(prefers-reduced-transparency: reduce)', '(prefers-contrast: more)']) {
            const m = window.matchMedia && matchMedia(q);
            if (m && m.addEventListener) m.addEventListener('change', () => this.apply());
        }
        this.apply();
    },

    wanted() {
        const root = document.documentElement;
        const media = (q) => window.matchMedia && matchMedia(q).matches;
        return this.can && root.dataset.glass === 'liquid' && !root.dataset.skin
            && !media('(prefers-reduced-transparency: reduce)') && !media('(prefers-contrast: more)');
    },

    apply() {
        const want = this.wanted();
        if (want === this.on) return;
        this.on = want;
        document.documentElement.classList.toggle('liquid-bends', want);
        if (want) this.start();
        else this.stop();
    },

    start() {
        if (!this.svg) {
            const ns = 'http://www.w3.org/2000/svg';
            this.svg = document.createElementNS(ns, 'svg');
            this.svg.setAttribute('aria-hidden', 'true');
            this.svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
            this.defs = document.createElementNS(ns, 'defs');
            this.svg.appendChild(this.defs);
        }
        document.body.appendChild(this.svg);
        this.resizes = new ResizeObserver(entries => { for (const e of entries) this.fit(e.target); });
        document.querySelectorAll(this.SELECTOR).forEach(el => this.watch(el));
        // Messages and the right-click menu come and go: watch what's added
        // (only the added element itself is checked, not what's in it)
        this.added = new MutationObserver(records => {
            for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1 && n.matches(this.SELECTOR)) this.watch(n);
        });
        this.added.observe(document.body, { childList: true, subtree: true });
    },

    stop() {
        if (this.resizes) this.resizes.disconnect();
        if (this.added) this.added.disconnect();
        this.resizes = this.added = null;
        for (const el of this.parts.keys()) el.style.removeProperty('--lg-bend');
        this.parts.clear();
        this.maps.clear();
        if (this.defs) this.defs.textContent = '';
        if (this.svg) this.svg.remove();
    },

    watch(el) {
        if (this.parts.has(el) || !this.resizes) return;
        this.parts.set(el, null);
        this.resizes.observe(el);
    },

    // A part's size or shape changed (or it showed): its map
    fit(el) {
        if (!this.on) return;
        if (!el.isConnected) {
            this.release(el);
            this.parts.delete(el);
            this.resizes.unobserve(el);
            return;
        }
        // Layout size, in the element's own pixels (before any zoom), which
        // is what the filter is drawn in
        const w = el.offsetWidth, h = el.offsetHeight;
        if (w < 8 || h < 8) return; // hidden
        const cs = getComputedStyle(el);
        const r = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, w / 2, h / 2);
        const root = getComputedStyle(document.documentElement);
        const bezel = Math.min(parseFloat(root.getPropertyValue('--lg-bezel')) || 16, w / 2, h / 2);
        const depth = parseFloat(root.getPropertyValue('--lg-depth')) || 14;
        const key = `${w}x${h}r${Math.round(r)}b${Math.round(bezel)}d${depth}`;
        if (this.parts.get(el) === key) return;
        this.release(el);
        let map = this.maps.get(key);
        if (!map) map = this.make(key, w, h, r, bezel, depth);
        map.users++;
        map.used = ++this.seq;
        this.parts.set(el, key);
        el.style.setProperty('--lg-bend', `url(#${map.id})`);
    },

    release(el) {
        const key = this.parts.get(el);
        const map = key && this.maps.get(key);
        if (map) map.users--;
        this.parts.set(el, null);
        // Forget the maps no part has used for longest, past KEEP of them
        const idle = [...this.maps.entries()].filter(([, m]) => m.users <= 0).sort((a, b) => a[1].used - b[1].used);
        for (const [k, m] of idle.slice(0, Math.max(0, idle.length - this.KEEP))) {
            this.maps.delete(k);
            const f = document.getElementById(m.id);
            if (f) f.remove();
        }
    },

    make(key, w, h, r, bezel, depth) {
        const id = `lg-${++this.seq}`;
        const ns = 'http://www.w3.org/2000/svg';
        const f = document.createElementNS(ns, 'filter');
        f.id = id;
        // The filter's area is the element's: anything else and Chromium
        // stretches what's behind it to fit
        for (const [k, v] of Object.entries({ x: 0, y: 0, width: 1, height: 1, 'color-interpolation-filters': 'sRGB' })) f.setAttribute(k, v);
        const img = document.createElementNS(ns, 'feImage');
        for (const [k, v] of Object.entries({ href: this.map(w, h, r, bezel), x: 0, y: 0, width: w, height: h, preserveAspectRatio: 'none', result: 'bend' })) img.setAttribute(k, v);
        const move = document.createElementNS(ns, 'feDisplacementMap');
        // Red and green 128 is still; 255 or 0 moves it scale / 2 either way
        for (const [k, v] of Object.entries({ in: 'SourceGraphic', in2: 'bend', scale: depth * 2, xChannelSelector: 'R', yChannelSelector: 'G' })) move.setAttribute(k, v);
        f.append(img, move);
        this.defs.appendChild(f);
        const map = { id, users: 0, used: 0 };
        this.maps.set(key, map);
        return map;
    },

    // The displacement map for a w × h rounded rectangle of radius r: in
    // red (x) and green (y), how far to look in from the edge, 0 in the
    // middle, rising to the full depth at the edge over the bezel. The rim
    // curves ever more steeply, so the last pixels fold back on themselves,
    // the thin bright line round real glass
    map(w, h, r, bezel) {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const g = c.getContext('2d');
        const im = g.createImageData(w, h);
        const d = im.data;
        const iw = w / 2 - r, ih = h / 2 - r; // the straight part's half size
        for (let y = 0; y < h; y++) {
            const py = y + 0.5 - h / 2, qy = Math.abs(py) - ih;
            for (let x = 0; x < w; x++) {
                const px = x + 0.5 - w / 2, qx = Math.abs(px) - iw;
                // How far in from the edge, and which way is in
                let dist, nx, ny;
                if (qx > 0 && qy > 0) {
                    const l = Math.hypot(qx, qy);
                    dist = r - l;
                    nx = qx / l;
                    ny = qy / l;
                } else if (qx > qy) {
                    dist = r - qx; nx = 1; ny = 0;
                } else {
                    dist = r - qy; nx = 0; ny = 1;
                }
                const t = dist < bezel ? Math.min(1, Math.max(0, 1 - dist / bezel)) : 0;
                const m = t * t * (1.6 - 0.6 * t); // gentle inside, steep at the rim
                const i = (y * w + x) * 4;
                d[i] = Math.round(128 - Math.sign(px) * nx * m * 127);
                d[i + 1] = Math.round(128 - Math.sign(py) * ny * m * 127);
                d[i + 2] = 128;
                d[i + 3] = 255;
            }
        }
        g.putImageData(im, 0, 0);
        return c.toDataURL();
    }
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => Liquid.init());
else Liquid.init();
