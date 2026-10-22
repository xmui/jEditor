window.__pre = () => {
    __themeParts({
        layout: 'docked', skin: 'snow', titlebar: true,
        title: () => document.body.dataset.view === 'single' ? (document.getElementById('file-name-text')?.textContent || '') : 'Summer 2024'
    });
};
setInterval(() => document.querySelectorAll('#grid-view .grid-item').forEach(t => { const i = t.querySelector('img'); if (i && t.dataset.name !== i.alt) t.dataset.name = i.alt; }), 100);
