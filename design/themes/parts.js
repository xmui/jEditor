// Prototype of the theme "parts": our own title bar, and a menu bar.
window.__themeParts = (opts) => {
    const ui = document.getElementById('main-interface');
    document.documentElement.dataset.layout = opts.layout || '';
    document.documentElement.dataset.skin = opts.skin || '';
    if (opts.titlebar) {
        const t = document.createElement('div');
        t.id = 'th-titlebar';
        t.innerHTML = `<span class="th-appicon"></span><span class="th-title"></span><span class="th-caps"><button class="th-min" aria-label="Minimise"></button><button class="th-max" aria-label="Maximise"></button><button class="th-close" aria-label="Close"></button></span>`;
        ui.prepend(t);
        const sync = () => { t.querySelector('.th-title').textContent = opts.title(); };
        sync(); setInterval(sync, 200);
    }
    if (opts.menus) {
        const m = document.createElement('div');
        m.id = 'th-menubar';
        m.innerHTML = opts.menus.map(x => `<span class="th-menu">${x}</span>`).join('');
        ui.prepend(m);
        if (opts.titlebar) ui.prepend(document.getElementById('th-titlebar'));
    }
};
// Docked bars have room for everything: the fitting that squeezes the
// floating pills stands down (the real app would tell fit.js)
new MutationObserver(() => {
    if (!(document.documentElement.dataset.layout || '').includes('docked')) return;
    const ui = document.getElementById('main-interface');
    if (ui && ui.dataset.fit) ui.dataset.fit = '';
    document.querySelectorAll('[data-squeezed]').forEach(e => e.removeAttribute('data-squeezed'));
}).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['data-fit', 'data-squeezed'] });
