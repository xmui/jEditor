// Undo history: every step Ctrl+Z can take back, newest first, in a panel
// from the toolbar (History, H). Clicking a step goes back to just before
// it: that step and every newer one are undone, newest first, after an
// "are you sure". The steps are the undo list itself (script.js pushUndo),
// so it holds what Ctrl+Z holds: the last 50, while jEditor is open.

const History = {
    MAX_LISTED: 8, // steps named in the "are you sure"

    init(app) {
        if (this._inited) return;
        this._inited = true;
        this.app = app;
        this.panel = document.getElementById('history-panel');
        this.list = document.getElementById('history-list');
        const btn = document.getElementById('btn-history');
        if (btn) btn.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(); });
        this.list.addEventListener('click', (e) => {
            const row = e.target.closest('[data-step]');
            if (row) this.backTo(parseInt(row.dataset.step, 10));
        });
        this.list.addEventListener('keydown', (e) => {
            const rows = [...this.list.querySelectorAll('[data-step]')];
            const i = rows.indexOf(document.activeElement);
            if (i === -1 || !['ArrowDown', 'ArrowUp'].includes(e.key)) return;
            e.preventDefault();
            e.stopPropagation();
            rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))].focus();
        });
        // A click anywhere else closes it
        document.addEventListener('mousedown', (e) => {
            if (this.isOpen() && !this.panel.contains(e.target) && !e.target.closest('#btn-history') && !e.target.closest('#ui-dialog')) this.toggle(false);
        });
        // Times ("2 min ago") stay right while it's open
        setInterval(() => { if (this.isOpen()) this.render(); }, 30000);
    },

    isOpen() {
        return !!this.panel && !this.panel.classList.contains('hidden');
    },

    toggle(open = !this.isOpen()) {
        if (!this.panel) return;
        this.panel.classList.toggle('hidden', !open);
        const btn = document.getElementById('btn-history');
        if (btn) btn.setAttribute('aria-expanded', String(open));
        if (open) {
            if (this.app._infoOpen) this.app.toggleInfoPanel(false);
            this.render();
            const first = this.list.querySelector('[data-step]');
            if (first) first.focus({ preventScroll: true });
        }
    },

    // The undo list changed
    changed() {
        if (this.isOpen()) this.render();
        const btn = document.getElementById('btn-history');
        if (btn) btn.classList.toggle('has-steps', this.steps().length > 0);
    },

    // Newest first
    steps() {
        return (this.app._undoStack || []).slice().reverse();
    },

    render() {
        const steps = this.steps();
        this.list.textContent = '';
        document.getElementById('history-empty').classList.toggle('hidden', steps.length > 0);
        steps.forEach((entry, i) => {
            const d = this.describe(entry);
            const row = document.createElement('button');
            row.className = 'history-row';
            row.dataset.step = String(i);
            row.title = i === 0 ? 'Undo this step' : `Go back to before this: undoes it and the ${i} newer step${i === 1 ? '' : 's'} above it`;
            const what = document.createElement('span');
            what.className = 'history-what';
            what.textContent = d.what;
            const detail = document.createElement('span');
            detail.className = 'history-detail';
            detail.textContent = d.detail;
            const when = document.createElement('span');
            when.className = 'history-when';
            when.textContent = this.ago(entry.at);
            row.append(what, when, detail);
            this.list.appendChild(row);
        });
        this.panel.classList.toggle('busy', !!this._running);
    },

    // { what, detail }: what the step did, and to which photos
    describe(e) {
        const photos = (n) => `${n.toLocaleString()} photo${n === 1 ? '' : 's'}`;
        const one = (items, name = it => it.file && it.file.name) => items.length === 1 ? (name(items[0]) || photos(1)) : photos(items.length);
        const base = (p) => String(p || '').split('/').filter(Boolean).pop() || 'the project';
        const label = (l) => l ? l.charAt(0).toUpperCase() + l.slice(1) : 'Edit';
        switch (e.type) {
            case 'bytes': return { what: label(e.label), detail: e.file.name };
            case 'rotate': return { what: 'Rotation', detail: e.file.name };
            case 'group': return { what: 'Rotation', detail: photos(e.count || e.items.length) };
            case 'rename': return { what: 'Rename', detail: `${e.oldName} → ${e.file.name}` };
            case 'batch-rename': return { what: 'Rename', detail: one(e.items) };
            case 'flags': return { what: this.flagWhat(e), detail: one(e.items) };
            case 'auto-crop': return { what: 'Auto crop', detail: one(e.items) };
            case 'edits': return { what: e.label === 'edits' ? 'Discard edits' : `${label(e.label)} (kept)`, detail: one(e.items) };
            case 'saved-edits': return { what: 'Save edits', detail: one(e.edits) };
            case 'trash': return { what: 'Delete', detail: one(e.items, it => it.file ? it.file.name : it.name) };
            case 'relocate': return { what: e.copy ? 'Copy' : 'Move', detail: `${photos(e.items.length)} to ${base(e.dest)}` };
            case 'transfer':
            case 'folder-out': return { what: e.copy ? 'Copy' : 'Move', detail: e.where ? `${photos(e.items.length)} to ${e.where}` : photos(e.items.length) };
            case 'folder-create': return { what: 'New folder', detail: (e.paths || []).map(base).join(', ') };
            case 'folder-rename': return { what: 'Rename folder', detail: `${e.name} → ${base(e.path)}` };
            case 'folder-delete': return { what: 'Delete folder', detail: base(e.path) };
            default: return { what: label(e.label || e.type), detail: '' };
        }
    },

    flagWhat(e) {
        if (e.kind === 'clear') return 'Clear flags';
        if (e.kind === 'star') return e.on === false ? 'Unstar' : 'Star';
        if (e.kind === 'rescan') return e.on === false ? 'Rescan flag off' : 'Needs rescan';
        if (e.kind) return `${Flags.label(e.kind)} label${e.on === false ? ' off' : ''}`;
        return 'Flags';
    },

    ago(at) {
        if (!at) return '';
        const s = Math.round((Date.now() - at) / 1000);
        if (s < 45) return 'just now';
        if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
        return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    },

    // Undo step i (0: the newest) and every newer one, newest first
    async backTo(i) {
        const app = this.app;
        if (this._running) return;
        const steps = this.steps().slice(0, i + 1);
        if (!steps.length) return;
        const n = steps.length;
        const named = steps.slice(0, this.MAX_LISTED).map(s => { const d = this.describe(s); return d.detail ? `${d.what}: ${d.detail}` : d.what; });
        if (n > this.MAX_LISTED) named.push(`and ${n - this.MAX_LISTED} more`);
        const ok = await UI.confirm({
            title: n === 1 ? 'Undo this step?' : `Go back ${n} steps?`,
            message: n === 1 ? 'This is undone:' : 'These are undone, newest first:',
            items: named,
            ok: n === 1 ? 'Undo' : `Undo ${n} steps`
        });
        if (!ok) return;
        // Something else changed the list while asking
        const stack = app._undoStack || [];
        if (stack[stack.length - n] !== steps[n - 1]) {
            app.showToast('The history changed meanwhile — pick the step again');
            this.render();
            return;
        }
        this._running = true;
        this.render();
        let done = 0, error = null;
        app._quietToasts = n > 1;
        if (n > 1) app.beginTask('history', `Going back ${n} steps…`);
        try {
            for (const step of steps) {
                const s = app._undoStack || [];
                if (s[s.length - 1] !== step) { error = 'the history changed meanwhile'; break; }
                if (!await app.undo()) { error = app._undoError || 'a step couldn\'t be undone'; break; }
                done++;
                if (n > 1) app.updateTask('history', `Going back ${done}/${n}…`);
            }
        } finally {
            app._quietToasts = false;
            if (n > 1) app.endTask('history');
            this._running = false;
        }
        if (n > 1 || error) {
            app.showToast(error ? `Went back ${done} of ${n} steps — stopped: ${error}` : `Went back ${n} steps`, error ? 5000 : 2500,
                null, null, { type: error ? 'error' : 'info', kind: 'undo' });
        }
        this.changed();
    }
};
