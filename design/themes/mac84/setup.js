window.__pre = () => {
    // The theme's own setting (Settings would set it; the prototype takes it from the address)
    document.documentElement.dataset.tsThumbs = new URLSearchParams(location.search).get('thumbs') || 'dither';
    __themeParts({
        layout: 'docked', skin: 'mac84', titlebar: true,
        menus: ['File', 'Edit', 'View', 'Photo', 'Special'],
        title: () => document.body.dataset.view === 'single' ? (document.getElementById('file-name-text')?.textContent || '') : 'Summer 2024'
    });
};
// One bit, the MacPaint way: Atkinson dithering, at the size shown
const atkinson = (img, w, h) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    const r = Math.min(w / img.naturalWidth, h / img.naturalHeight);
    const dw = Math.round(img.naturalWidth * r), dh = Math.round(img.naturalHeight * r);
    const ox = Math.floor((w - dw) / 2), oy = Math.floor((h - dh) / 2);
    g.drawImage(img, ox, oy, dw, dh);
    const d = g.getImageData(0, 0, w, h), p = d.data, L = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
        const y = (0.299 * p[i * 4] + 0.587 * p[i * 4 + 1] + 0.114 * p[i * 4 + 2]) / 255;
        L[i] = Math.min(1, Math.max(0, (Math.pow(y, 0.85) - 0.5) * 1.15 + 0.5)) * 255;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x, inside = x >= ox && x < ox + dw && y >= oy && y < oy + dh;
        if (!inside) { L[i] = 255; continue; }
        const o = L[i], n = o < 128 ? 0 : 255, e = (o - n) / 8; L[i] = n;
        for (const [dx, dy] of [[1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [0, 2]]) {
            const X = x + dx, Y = y + dy;
            if (X >= ox && X < ox + dw && Y < oy + dh) L[Y * w + X] += e;
        }
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x, v = L[i] >= 128 ? 255 : 0;
        p[i * 4] = p[i * 4 + 1] = p[i * 4 + 2] = v;
        p[i * 4 + 3] = x >= ox && x < ox + dw && y >= oy && y < oy + dh ? 255 : 0;
    }
    // a one-pixel frame round the picture
    g.putImageData(d, 0, 0);
    g.strokeStyle = '#000'; g.lineWidth = 1; g.strokeRect(ox + 0.5, oy + 0.5, dw - 1, dh - 1);
    return c.toDataURL();
};
const dither = () => document.querySelectorAll('#grid-view .grid-item img, #thumbnail-strip .thumb-item img').forEach(im => {
    if (!im.complete || !im.naturalWidth || im.src.startsWith('data:')) return;
    const cs = getComputedStyle(im);
    const w = Math.floor(im.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    const h = Math.floor(im.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom));
    if (w < 8 || h < 8) return;
    im.src = atkinson(im, w, h);
});
setInterval(() => {
    document.querySelectorAll('#grid-view .grid-item').forEach(t => { const i = t.querySelector('img'); if (i && t.dataset.name !== i.alt) t.dataset.name = i.alt; });
    if (document.documentElement.dataset.skin === 'mac84' && document.documentElement.dataset.tsThumbs === 'dither') dither();
}, 100);
