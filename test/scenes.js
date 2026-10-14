// Synthetic scans with known answers, for the photo finder tests (ui.test.js)
// Synthetic scans with known answers, for PhotoFind (runs in the page)
window.Scenes = (() => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const photo = (g, w, h, kind) => {
        // busy content: blocks, a sky band sometimes
        if (kind === 'pale') {
            g.fillStyle = '#f2f0ea'; g.fillRect(-w / 2, -h / 2, w, h);
            for (let i = 0; i < 40; i++) { g.fillStyle = `hsla(${Math.floor(rnd() * 360)},20%,${70 + Math.floor(rnd() * 20)}%,0.7)`; g.beginPath(); g.ellipse(-w / 2 + rnd() * w, -h / 2 + rnd() * h, 4 + rnd() * w / 6, 4 + rnd() * h / 6, rnd() * 3, 0, 7); g.fill(); }
            return;
        }
        if (kind === 'dark') {
            for (let y = 0; y < h; y += 20) for (let x = 0; x < w; x += 20) {
                g.fillStyle = `hsl(${Math.floor(rnd() * 360)},30%,${3 + Math.floor(rnd() * 15)}%)`; g.fillRect(x - w / 2, y - h / 2, 20, 20);
            }
            return;
        }
        // like a photo: a gradient, then soft blobs of every size
        const gr = g.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
        gr.addColorStop(0, `hsl(${Math.floor(rnd() * 360)},40%,45%)`); gr.addColorStop(1, `hsl(${Math.floor(rnd() * 360)},40%,35%)`);
        g.fillStyle = gr; g.fillRect(-w / 2, -h / 2, w, h);
        for (let i = 0; i < 120; i++) {
            g.fillStyle = `hsla(${Math.floor(rnd() * 360)},${30 + Math.floor(rnd() * 40)}%,${15 + Math.floor(rnd() * 60)}%,0.8)`;
            g.beginPath(); g.ellipse(-w / 2 + rnd() * w, -h / 2 + rnd() * h, 4 + rnd() * w / 6, 4 + rnd() * h / 6, rnd() * 3, 0, 7); g.fill();
        }
        if (kind === 'sky') { g.fillStyle = '#cfe0ef'; g.fillRect(-w / 2, -h / 2, w, h * 0.35); }
    };
    // print: { x, y (centre), w, h, angle (deg clockwise), border (px, white), kind }
    const draw = (W, H, bed, prints, opts = {}) => {
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const g = c.getContext('2d');
        if (typeof bed === 'function') bed(g, W, H); else { g.fillStyle = bed; g.fillRect(0, 0, W, H); }
        if (opts.gradient) { const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,' + opts.gradient + ')'); g.fillStyle = gr; g.fillRect(0, 0, W, H); }
        for (const p of prints) {
            g.save(); g.translate(p.x, p.y); g.rotate(p.angle * Math.PI / 180);
            if (opts.shadow) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(-p.w / 2 - 1, -p.h / 2 - 1, p.w + 2, p.h + 2); }
            g.fillStyle = p.borderColor || '#fbfbf8'; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            const b = p.border || 0;
            g.save(); g.beginPath(); g.rect(-p.w / 2 + b, -p.h / 2 + b, p.w - 2 * b, p.h - 2 * b); g.clip();
            photo(g, p.w - 2 * b, p.h - 2 * b, p.kind); g.restore();
            g.restore();
        }
        if (opts.dust) { g.fillStyle = '#555'; for (let i = 0; i < 30; i++) g.fillRect(rnd() * W, rnd() * H, 2, 2); }
        if (opts.noise) {
            const im = g.getImageData(0, 0, W, H);
            for (let i = 0; i < im.data.length; i += 4) { const n = (rnd() - 0.5) * opts.noise; im.data[i] += n; im.data[i + 1] += n; im.data[i + 2] += n; }
            g.putImageData(im, 0, 0);
        }
        return c;
    };
    const truth = (p) => {
        const a = p.angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
        return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [p.x + i * p.w / 2 * c - j * p.h / 2 * s, p.y + i * p.w / 2 * s + j * p.h / 2 * c]);
    };
    // max distance from each true corner to the nearest found corner
    const err = (found, p) => {
        const t = truth(p);
        return Math.max(...t.map(([x, y]) => Math.min(...found.map(([u, v]) => Math.hypot(u - x, v - y)))));
    };
    return { draw, truth, err, reseed: (s) => { seed = s; } };
})();
