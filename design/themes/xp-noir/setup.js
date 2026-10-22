window.__pre = () => {
    __themeParts({
        layout: 'docked', skin: 'xp', titlebar: true,
        menus: ['File', 'Edit', 'View', 'Picture', 'Tools', 'Help'],
        title: () => (document.body.dataset.view === 'single' ? (document.getElementById('file-name-text')?.textContent || '') : 'Summer 2024') + ' - jEditor'
    });
};
// The real app would give each tile its name; the prototype copies it from the picture
setInterval(() => document.querySelectorAll('#grid-view .grid-item').forEach(t => { const i = t.querySelector('img'); if (i && t.dataset.name !== i.alt) t.dataset.name = i.alt; }), 100);
