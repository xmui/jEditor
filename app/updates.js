// Updates, in the apps (Settings → Updates).
//
// Beta builds: betas (v1.42.0-beta.N, from the beta branch) are offered
// too, for trying what's coming; on by default in a beta. Turned off, the
// next release (newer than any of its betas) takes you back.
//
// Once a day when jEditor starts (unless turned off), or when asked, it
// looks for a newer release on GitHub. A newer one is offered with what's
// new in it; updating downloads its setup and runs it, and jEditor closes
// and opens again on the new version (src/Updater.cs). Edits still being
// saved finish first.

const Updates = {
    DAY: 24 * 60 * 60 * 1000,
    KEY: 'jeditor.updateCheck',

    el(id) { return document.getElementById(id); },

    init(app) {
        this.app = app;
        if (!Host.has('updates')) return;
        this.el('upd-version').textContent = typeof APP_VERSION !== 'undefined' ? this.label(typeof APP_BUILD !== 'undefined' ? APP_BUILD : 'v' + APP_VERSION) : '';
        this.el('upd-check').addEventListener('click', () => {
            if (this.latest && this.latest.newer) this.offer(this.latest);
            else this.check({ manual: true });
        });
        this.el('upd-log').addEventListener('click', async () => {
            if (!await FolderCache.native().showLog().catch(() => false)) app.showToast('There\'s no log yet', 2500);
        });
        this.el('upd-auto').addEventListener('change', (e) => {
            app.uiPrefs.autoUpdate = e.target.checked;
            app.saveUiPrefs();
        });
        this.el('upd-beta').addEventListener('change', (e) => {
            app.uiPrefs.betaUpdates = e.target.checked;
            app.saveUiPrefs();
            this.latest = null;
            this.el('upd-check').textContent = 'Check for updates';
            this.check({ manual: false });
        });
        // Once the settings are loaded and jEditor is up
        setTimeout(() => this.start(), 3000);
    },

    // "v1.42.0-beta.3" → "1.42.0 beta 3"; "v1.41.0-2" → "1.41.0"
    label(tag) {
        const m = /(\d+\.\d+\.\d+)(?:-beta\.(\d+))?/.exec(String(tag || ''));
        if (!m) return String(tag || '');
        return m[2] ? `${m[1]} beta ${m[2]}` : m[1];
    },

    // Betas offered: as chosen, else yes on a beta (it came from there)
    beta() {
        const chosen = this.app.uiPrefs.betaUpdates;
        if (chosen !== undefined) return !!chosen;
        return typeof APP_BUILD !== 'undefined' && /-beta\./.test(APP_BUILD);
    },

    start() {
        this.el('upd-auto').checked = this.app.uiPrefs.autoUpdate !== false;
        this.el('upd-beta').checked = this.beta();
        const last = this.lastCheck();
        if (last) this.status(`Up to date when last checked, ${this.when(last)}`);
        if (this.app.uiPrefs.autoUpdate !== false && Date.now() - last > this.DAY) this.check({ manual: false });
    },

    lastCheck() {
        try { return +localStorage.getItem(this.KEY) || 0; } catch (e) { return 0; }
    },

    when(ts) {
        const t = new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        return `${Recents.when(ts).replace(/^[A-Z]/, c => c.toLowerCase())} at ${t}`;
    },

    status(text) {
        this.el('upd-status').textContent = text;
    },

    async check({ manual }) {
        const button = this.el('upd-check');
        button.disabled = true;
        this.status('Checking…');
        try {
            const r = await FolderCache.native().checkUpdate({ beta: this.beta() });
            try { localStorage.setItem(this.KEY, String(Date.now())); } catch (e) { /* private */ }
            this.latest = r;
            if (r.newer) {
                const name = this.label(r.tag);
                this.status(`jEditor ${name} is available`);
                button.textContent = `Update to ${name}`;
                if (manual) this.offer(r);
                else this.app.showToast(`jEditor ${name} is available`, 15000, 'update', { label: 'Update…', run: () => this.offer(r) }, { type: 'info' });
            } else {
                this.status(`Up to date, checked ${this.when(Date.now())}`);
                if (manual) this.app.showToast('jEditor is up to date', 2500, null, null, { type: 'success' });
            }
        } catch (e) {
            this.status(`Couldn't check: ${e.message}`);
            if (manual) this.app.showToast(`Couldn't check for updates: ${e.message}`, 4000);
        } finally {
            button.disabled = false;
        }
    },

    // The release notes' list of changes ("- …" lines)
    changes(notes) {
        return String(notes || '').split(/\r?\n/).filter(l => /^\s*[-*] /.test(l)).map(l => l.replace(/^\s*[-*] /, '')).slice(0, 8);
    },

    async offer(r) {
        const ok = await UI.confirm({
            title: `Update to jEditor ${this.label(r.tag)}?`,
            message: `You have ${typeof APP_VERSION !== 'undefined' ? this.label(typeof APP_BUILD !== 'undefined' ? APP_BUILD : 'v' + APP_VERSION) : 'an older version'}. ` + (Host.mac()
                ? 'jEditor downloads it, puts it in place of this one and opens again, in about a minute. Your edits are already saved.'
                : Host.platform() === 'linux' ? 'jEditor downloads it, installs it (your password may be asked for) and opens again, in about a minute. Your edits are already saved.'
                : 'jEditor closes, installs the update and opens again, in about a minute. Your edits are already saved.'),
            items: this.changes(r.notes),
            ok: 'Update now'
        });
        if (ok) this.install();
    },

    async install() {
        const app = this.app;
        app.beginTask('update', 'Downloading the update…');
        try {
            await this.settle();
            const r = await FolderCache.native().installUpdate((got, total) => {
                if (total) app.updateTask('update', `Downloading the update… ${Math.round(got / total * 100)}%`);
            });
            // The Mac app replaces itself, except where it can't (not in
            // Applications): then the update opens in Finder, to drag in
            const opened = r && r.inPlace === false;
            const finder = Host.mac() && opened;
            app.updateTask('update', finder ? 'Opened the update in Finder: drag jEditor into Applications'
                : opened ? 'Opened the update with your software installer'
                : 'Installing the update — jEditor opens again in a moment');
            if (opened && r.why) app.showToast(`Opened the update ${finder ? 'in Finder' : 'to install'} (${r.why})`, 8000);
        } catch (e) {
            app.endTask('update');
            UI.alert({ title: 'Couldn\'t update', message: e.message });
        }
    },

    // Rotations and flags still being saved finish first (up to 15 s)
    async settle() {
        const app = this.app;
        const until = Date.now() + 15000;
        while (Date.now() < until && app.files.some(f => f._rotationQueue || f.isBusy)) {
            await new Promise(r => setTimeout(r, 100));
        }
        try { await Flags.save(); } catch (e) { /* best-effort */ }
        try { await Edits.flush(); } catch (e) { /* best-effort */ }
        await FolderCache.flush();
    }
};
