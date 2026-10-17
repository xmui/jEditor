// The app jEditor runs in: the Windows app (src/bridge.js), the Mac or
// Linux app (mac/), or none (a browser). Whatever the app adds is on window.JEditorNative.
//
// Every app gives the page jEditor's storage and paths (dataDir,
// folderPath, openPath, exists): the order's data is kept by the app, not
// in a .jeditor folder (folder-cache.js). The rest are features, and each
// app lists the ones it has (JEditorNative.features). The UI asks for the
// one it needs, so an app without it never shows it:
//
//   recycle      deleted photos to the system's bin, and back (Ctrl+Z)
//   reveal       show a folder in Explorer / Finder
//   places       the sidebar: projects, pinned folders, drives
//   quickAccess  Explorer's Quick Access in the sidebar's Pinned
//   windows      several windows, Split, moving photos between them
//   scan         scanning into the project
//   camera       tethered shooting
//   backdrop     Mica / Acrylic behind the window
//   log          the app's log
//   updates      looking for a new version and installing it
//
// Wording that names the system's own things comes from here too: in a
// text, {files} is Explorer, Finder or Files, {computer} this PC or this Mac, and
// {bin} where deleted photos go. On a Mac, keys are said the Mac's way:
// "Ctrl+Z" is "⌘Z" (the keys themselves already work with ⌘).


const Host = {
    get() {
        return window.JEditorNative || null;
    },

    // 'windows', 'mac' or 'linux' (an app), or 'web'
    platform() {
        const n = this.get();
        return n ? (n.platform || 'windows') : 'web';
    },

    has(feature) {
        const n = this.get();
        return !!n && Array.isArray(n.features) && n.features.includes(feature);
    },

    mac() {
        const p = this.platform();
        if (p !== 'web') return p === 'mac';
        return /Mac/i.test(navigator.platform || navigator.userAgent || '');
    },

    words() {
        const app = !!this.get();
        const mac = this.mac();
        const linux = this.platform() === 'linux';
        return {
            files: mac ? 'Finder' : linux ? 'Files' : 'Explorer',
            computer: !app || linux ? 'this computer' : mac ? 'this Mac' : 'this PC',
            bin: this.has('recycle') ? (mac ? 'the Trash' : 'the Recycle Bin')
                : app ? 'jEditor\'s trash' : 'the trash in .jeditor'
        };
    },

    // "Show in {files}" → "Show in Finder"; on a Mac, "Ctrl+Z" → "⌘Z"
    say(text) {
        const w = this.words();
        return this.keys(String(text).replace(/\{(files|computer|bin)\}/g, (m, k) => w[k]));
    },

    // On a Mac: "Ctrl+Z" → "⌘Z", "Ctrl+Shift+Z" → "⇧⌘Z", "Ctrl+click" →
    // "⌘-click". Ctrl+wheel stays: zooming takes the Ctrl key (or a pinch)
    // there too.
    keys(text) {
        if (!this.mac()) return text;
        return text.replace(/\bCtrl\+(Alt\+|Shift\+)?(click\b|wheel\b)?/g, (m, mod, word) => {
            if (word === 'wheel') return m;
            const pre = mod === 'Shift+' ? '⇧' : mod === 'Alt+' ? '⌥' : '';
            return word ? `${pre}⌘-${word}` : `${pre}⌘`;
        });
    },

    // Once, as the page starts: hides what the app can't do (data-needs="scan")
    // and puts this system's words into the page's texts and tooltips
    apply(root = document.body) {
        // For the look of each app (tokens.css: data-platform)
        document.documentElement.dataset.platform = this.platform();
        root.querySelectorAll('[data-needs]').forEach(el => {
            if (!el.dataset.needs.split(/\s+/).every(f => this.has(f))) el.classList.add('host-missing');
        });
        const said = /\{(files|computer|bin)\}|\bCtrl\+/;
        const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode: n => said.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
        });
        for (let n = walk.nextNode(); n; n = walk.nextNode()) n.nodeValue = this.say(n.nodeValue);
        for (const attr of ['title', 'aria-label', 'placeholder', 'data-native-text', 'data-native-title']) {
            root.querySelectorAll(`[${attr}*="{"], [${attr}*="Ctrl+"]`).forEach(el => el.setAttribute(attr, this.say(el.getAttribute(attr))));
        }
    }
};
