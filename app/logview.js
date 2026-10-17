// Details (the Windows app): jEditor's log, live, for finding out what a
// scanner is doing when it isn't doing what it should. The last few hundred
// lines the app wrote, then each new one as it's written; Copy, to send
// them on, and the log file in Explorer.
//
// LogView.attach(root, app) → { show(), hide(), toggle(), shown }. `root` has a
// .log-lines element and [data-log="copy"] / [data-log="file"] buttons.

const LogView = {
    MAX: 500, // lines kept on screen
    views: new Set(), // those showing: the app sends lines while there are any

    native() { return FolderCache.native(); },

    attach(root, app) {
        const view = { root, app, box: root.querySelector('.log-lines'), seen: new Set() };
        root.querySelector('[data-log="copy"]').addEventListener('click', () => this.copy(view));
        root.querySelector('[data-log="file"]').addEventListener('click', () => this.native().showLog());
        const api = {
            show: () => this.show(view),
            hide: () => this.hide(view),
            toggle: () => (this.views.has(view) ? this.hide(view) : this.show(view)),
            get shown() { return LogView.views.has(view); }
        };
        return api;
    },

    async show(view) {
        if (this.views.has(view)) return;
        view.root.classList.remove('hidden');
        this.views.add(view);
        if (this.views.size === 1) this.native().watchLog(lines => this.views.forEach(v => this.append(v, lines)));
        view.box.textContent = '';
        view.seen = new Set();
        try {
            const { lines } = await this.native().logTail();
            if (!this.views.has(view)) return;
            // Lines that came in while asking are in these too
            view.box.textContent = '';
            view.seen = new Set((lines || []).slice(-50));
            this.append(view, lines || [], true);
        } catch (e) {
            this.append(view, [`Couldn't read the log: ${e.message}`]);
        }
    },

    hide(view) {
        if (!this.views.delete(view)) return;
        view.root.classList.add('hidden');
        if (!this.views.size) this.native().watchLog(null);
    },

    kind(line) {
        if (/\b(error|failed|exception|couldn't|didn't|can't|not found|giving up)\b/i.test(line)) return 'err';
        if (/ naps2 (Trace|Debug):/.test(line)) return 'dim';
        if (/ page (log|info):/.test(line)) return 'dim';
        return '';
    },

    append(view, lines, first = false) {
        const box = view.box;
        const atEnd = first || box.scrollTop + box.clientHeight >= box.scrollHeight - 24;
        const frag = document.createDocumentFragment();
        for (const line of lines) {
            if (!first && view.seen.size) {
                if (view.seen.has(line)) continue;
                view.seen.clear(); // past the overlap
            }
            const div = document.createElement('div');
            div.textContent = line;
            const k = this.kind(line);
            if (k) div.className = k;
            frag.appendChild(div);
        }
        box.appendChild(frag);
        while (box.childElementCount > this.MAX) box.firstElementChild.remove();
        if (atEnd) box.scrollTop = box.scrollHeight;
    },

    async copy(view) {
        const text = [...view.box.children].map(d => d.textContent).join('\n');
        try {
            await navigator.clipboard.writeText(text);
        } catch (e) {
            const t = document.createElement('textarea');
            t.value = text;
            document.body.appendChild(t);
            t.select();
            document.execCommand('copy');
            t.remove();
        }
        if (view.app) view.app.showToast('Log copied', 2000, null, null, { type: 'success' });
    }
};
