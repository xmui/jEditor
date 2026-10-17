// What the Mac asks before jEditor may open photos, in one place: the
// first time jEditor opens, and from Settings → Projects (or jEditor →
// Permissions… in the menu bar). Each row says what it's for and whether
// it's on, and either asks (macOS's own question) or opens the right page
// of System Settings. Only an app with the 'permissions' feature (the Mac
// app: mac/main.js) has it.

const Permissions = {
    ROWS: {
        folders: {
            title: 'Desktop, Documents and Downloads',
            text: 'So jEditor can open folders of photos there. macOS asks once for each.',
            icon: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'
        },
        volumes: {
            title: 'USB drives and memory cards',
            text: 'To open photos on them and copy projects onto them.',
            icon: '<rect width="10" height="14" x="7" y="8" rx="2"/><path d="M9 8V3h6v5"/><path d="M10 5h1M13 5h1"/>'
        },
        full: {
            title: 'Full Disk Access',
            text: 'Optional: every folder opens without macOS asking, network drives too. Turn jEditor on in the list, then open jEditor again.',
            icon: '<rect width="16" height="11" x="4" y="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'
        }
    },

    init(app) {
        this.app = app;
        this.panel = document.getElementById('permissions-panel');
        if (!this.panel || !Host.has('permissions')) return;
        document.getElementById('perm-done').addEventListener('click', () => this.close());
        document.getElementById('perm-close').addEventListener('click', () => this.close());
        this.panel.addEventListener('mousedown', (e) => { if (e.target === this.panel) this.close(); });
        this.panel.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
        });
        const open = document.getElementById('cust-permissions');
        if (open) open.addEventListener('click', () => this.open());
        // Back from System Settings: what changed shows
        addEventListener('focus', () => { if (this.isOpen()) this.refresh(); });
        Host.get().permissions().then(r => { if (r && r.firstRun) this.open(r); }).catch(() => { });
    },

    isOpen() {
        return !!this.panel && !this.panel.classList.contains('hidden');
    },

    async open(r) {
        if (!this.panel) return;
        this.render((r || await Host.get().permissions()).rows);
        this.panel.classList.remove('hidden');
        Host.get().permissionsSeen();
    },

    close() {
        if (this.panel) this.panel.classList.add('hidden');
    },

    async refresh() {
        this.render((await Host.get().permissions()).rows);
    },

    render(rows) {
        const list = document.getElementById('perm-list');
        list.textContent = '';
        for (const row of rows) {
            const def = this.ROWS[row.id];
            if (!def) continue;
            const item = document.createElement('div');
            item.className = 'perm-row';
            item.dataset.id = row.id;
            item.dataset.state = row.state;
            item.innerHTML = `<svg class="i perm-icon" viewBox="0 0 24 24" aria-hidden="true">${def.icon}</svg>
                <div class="perm-text"><strong></strong><small></small></div><div class="perm-act"></div>`;
            item.querySelector('strong').textContent = def.title;
            item.querySelector('small').textContent = def.text;
            const act = item.querySelector('.perm-act');
            const status = (text, cls) => {
                const s = document.createElement('span');
                s.className = 'perm-status ' + cls;
                s.textContent = text;
                act.appendChild(s);
            };
            const button = (label, primary, run) => {
                const b = document.createElement('button');
                b.className = 'btn ' + (primary ? 'primary' : 'secondary');
                b.textContent = label;
                b.addEventListener('click', async () => {
                    b.disabled = true;
                    try { await run(); } finally { await this.refresh(); }
                });
                act.appendChild(b);
            };
            const settings = () => Host.get().openPermissionSettings(row.id);
            if (row.state === 'granted') status('On', 'on');
            else if (row.state === 'later') status('Asked when you plug one in', 'later');
            else if (row.state === 'ask') button('Allow…', true, () => Host.get().askPermission(row.id));
            else button('Open Settings', row.id !== 'full', settings);
            list.appendChild(item);
        }
    }
};
