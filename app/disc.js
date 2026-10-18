// Burning a project onto a CD or DVD (the Windows app: Burn.cs, with
// Windows' own IMAPI2). The burner chosen if there's more than one, a
// blank disc checked for and its room against the project's size, the
// disc named (the project's name, as much as a disc keeps), edits not
// saved yet offered to be saved first (the disc gets the photos as they
// are on disk), then burnt, with how far it's got, and ejected.

const Disc = {
    native() { return FolderCache.native(); },

    init(app) {
        this.app = app;
    },

    async open(path = Places.current()) {
        const app = this.app;
        const native = this.native();
        if (!path || !native || !Host.has('burn')) return;
        app.beginTask('burners', 'Looking for a disc burner…');
        let burners = [];
        try {
            burners = await native.burners();
        } catch (e) {
            app.endTask('burners');
            UI.alert({ title: 'Couldn\'t find a disc burner', message: e.message });
            return;
        } finally {
            app.endTask('burners');
        }
        if (!burners.length) {
            UI.alert({ title: 'No disc burner', message: Host.say('{computer} has no drive that can burn CDs or DVDs. Copy the project to a USB drive instead.') });
            return;
        }
        const ready = burners.filter(b => b.canWrite);
        if (!ready.length) {
            const b = burners[0];
            UI.alert({
                title: 'Put in a blank disc',
                message: b.media === 'none' ? `Put a blank CD or DVD in ${b.name}${b.drive ? ` (${b.drive})` : ''}, then try again.`
                    : `The ${b.media} in ${b.name} isn't blank. Put in a blank CD or DVD, then try again.`
            });
            return;
        }
        const pick = ready.length === 1 ? ready[0] : await new Promise(res => {
            app.openContextMenu(ready.map(b => [`${b.name}${b.drive ? ` (${b.drive})` : ''} — ${b.media}, ${app.formatBytes(b.free)}`, () => res(b)]), innerWidth / 2 - 140, innerHeight / 3);
            setTimeout(() => res(null), 60000);
        });
        if (!pick) return;
        const name = Places.baseName(path);
        const open = Places.key(path) === Places.key(Places.current());
        let bytes = 0;
        if (open) for (const f of app.files) bytes += f.size || 0;
        if (bytes && bytes > pick.free) {
            UI.alert({ title: 'It doesn\'t fit on the disc', message: `${name} has ${app.formatBytes(bytes)} of photos, and the ${pick.media} holds ${app.formatBytes(pick.free)}. Use a DVD (or a dual-layer one), or copy it to a USB drive.` });
            return;
        }
        // Edits not saved yet: the disc would get the photos without them
        if (open && Edits.count()) {
            const n = Edits.count();
            const how = await UI.choose({
                title: `${n.toLocaleString()} photo${n === 1 ? ' has' : 's have'} edits not saved yet`,
                message: 'The disc gets the photos as they are on disk. Save the edits into them first, or burn them as they are?',
                ok: 'Save edits, then burn',
                alt: 'Burn as they are'
            });
            if (!how) return;
            if (how === 'ok' && !(await Edits.saveAll({ overwrite: true }))) return;
        }
        const label = await UI.prompt({
            title: `Burn ${name} to a ${pick.media}`,
            message: `${bytes ? app.formatBytes(bytes) + ' of photos. ' : ''}It takes a few minutes; the disc comes out when it's done.`,
            input: { label: 'The disc\'s name', value: name.slice(0, 16) },
            ok: 'Burn'
        });
        if (label === null) return;
        const key = 'burn';
        let last = -1, toast = null;
        const say = (pct) => { toast = app.showToast(`Burning ${name}…${pct === null ? '' : ` ${pct}%`}`, 0, key, null, { type: 'progress' }); };
        say(null);
        app.beginTask('burn', `Burning ${name}…`);
        try {
            await native.burn(pick.id, path, label.trim() || name, (done, total) => {
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
