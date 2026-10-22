// Burning a project onto a CD or DVD (the Windows app: Burn.cs, with
// Windows' own IMAPI2). The Export window (export.js) chooses the burner,
// checks for a blank disc and its room against the project's size, names
// the disc (the project's name, as much as a disc keeps) and offers to
// save edits not saved yet first (the disc gets the photos as they are on
// disk); this burns it, with how far it's got, and ejects it.

const Disc = {
    native() { return FolderCache.native(); },

    init(app) {
        this.app = app;
    },

    // The Export window's CD or DVD (export.js) chooses the burner, says if
    // it's blank and whether the project fits, and names the disc
    open(path = Places.current()) {
        if (path && Host.has('burn')) Export.open({ path, tab: 'disc' });
    },

    // The burners and what's in each: [{ id, name, drive, media, canWrite, free }]
    async burners() {
        return this.native().burners();
    },

    // Burns the project at `path` onto the disc in `pick`, called `label`;
    // edits not saved yet saved into the photos first if `saveEdits`
    async burn(pick, path, label, { saveEdits = false } = {}) {
        const app = this.app;
        const native = this.native();
        const name = Places.baseName(path);
        if (saveEdits && Edits.count() && !(await Edits.saveAll({ overwrite: true }))) return;
        const key = 'burn';
        let last = -1, toast = null;
        const say = (pct) => { toast = app.showToast(`Burning ${name}…${pct === null ? '' : ` ${pct}%`}`, 0, key, null, { type: 'progress' }); };
        say(null);
        app.beginTask('burn', `Burning ${name}…`);
        try {
            await native.burn(pick.id, path, String(label || '').trim() || name, (done, total) => {
                const pct = total ? Math.min(100, Math.floor(done * 100 / total)) : null;
                if (pct !== last) { last = pct; say(pct); }
            }, true);
            app.showToast(`Burnt ${name} to the ${pick.media} — take it out of the drive`, 8000, key, null, { type: 'success' });
        } catch (e) {
            if (toast) app.dismissToast(toast);
            UI.alert({ title: `Couldn't burn ${name}`, message: e.message });
        } finally {
            app.endTask('burn');
        }
    }
};
