// The start screen says which jEditor this is ("Mac · 1.41.0" beside the
// name), and the web version offers the app for the computer it's on:
// Windows, Mac or Linux get that download first (the others below it),
// an iPhone or iPad gets Add to Home Screen.

const Start = {
    RELEASES: 'https://github.com/xmui/jEditor/releases',
    NAMES: { windows: 'Windows', mac: 'Mac', linux: 'Linux', web: 'Web' },

    // The computer the web version is on: 'windows', 'mac', 'linux', 'ios',
    // 'android' or 'other' (an iPad says it's a Mac: it's the one with touch)
    device(nav = navigator) {
        const p = String((nav.userAgentData && nav.userAgentData.platform) || nav.platform || '');
        const ua = String(nav.userAgent || '');
        if (/iPhone|iPad|iPod/.test(ua) || (/Mac/.test(p) && nav.maxTouchPoints > 1)) return 'ios';
        if (/Android/i.test(ua)) return 'android';
        if (/Win/i.test(p)) return 'windows';
        if (/Mac/i.test(p)) return 'mac';
        if (/Linux|X11|CrOS/i.test(p + ' ' + ua)) return 'linux';
        return 'other';
    },

    // Each app's downloads, the first the one to suggest
    downloads(v) {
        const file = (name) => `${this.RELEASES}/latest/download/${name}`;
        return {
            windows: [
                { label: 'Download for Windows', note: 'Windows 10 and 11, no admin needed', href: file(`jEditor-Setup-${v}.exe`) },
                { label: 'Portable zip', href: file(`jEditor-${v}-portable.zip`) }
            ],
            mac: [
                { label: 'Download for Mac', note: 'Apple silicon and Intel, macOS 12 or later', href: file(`jEditor-${v}-mac.dmg`) },
                { label: 'Copy Homebrew command', copy: 'brew tap xmui/jeditor https://github.com/xmui/jEditor && brew install --cask jeditor' }
            ],
            linux: [
                { label: 'Download for Linux', note: 'AppImage, any 64-bit Linux', href: file(`jEditor-${v}-linux.AppImage`) },
                { label: '.deb', href: file(`jEditor-${v}-linux.deb`) },
                { label: 'Arch', href: file(`jEditor-${v}-linux.pacman`) }
            ]
        };
    },

    init() {
        const name = this.NAMES[Host.platform()] || 'Web';
        const badge = document.querySelector('#app-title .app-version');
        if (badge) {
            badge.textContent = `${name} · ${badge.textContent}`;
            badge.title = `jEditor for ${name === 'Web' ? 'the web' : name}, version ${typeof APP_VERSION !== 'undefined' ? APP_VERSION : ''}`;
        }
        if (Host.get()) return;
        this.renderGet(this.device());
    },

    // The web version only: the app for this computer, then the others
    renderGet(device) {
        const box = document.getElementById('start-get');
        if (!box || typeof APP_VERSION === 'undefined') return;
        const all = this.downloads(APP_VERSION);
        box.textContent = '';
        const head = document.createElement('p');
        head.className = 'start-get-head';
        box.appendChild(head);
        const row = document.createElement('div');
        row.className = 'start-get-row';
        box.appendChild(row);
        const link = (d, primary) => {
            const a = document.createElement('a');
            a.className = primary ? 'btn primary' : 'btn secondary';
            a.href = d.href;
            a.rel = 'noopener';
            a.textContent = d.label;
            if (d.note) a.title = d.note;
            return a;
        };
        if (all[device]) {
            head.textContent = 'jEditor is also an app: no permission prompts, and it opens folders from your files.';
            const [main, ...more] = all[device];
            row.appendChild(link(main, true));
            for (const d of more) {
                if (d.copy) {
                    // A command for the Terminal: copied, not shown
                    const b = document.createElement('button');
                    b.className = 'btn secondary';
                    b.textContent = d.label;
                    b.title = d.copy;
                    b.dataset.copy = d.copy;
                    b.addEventListener('click', () => {
                        navigator.clipboard.writeText(d.copy).then(() => {
                            b.textContent = 'Copied: paste it in Terminal';
                            setTimeout(() => { b.textContent = d.label; }, 2500);
                        }, () => { b.textContent = d.copy; });
                    });
                    row.appendChild(b);
                } else {
                    row.appendChild(link(d, false));
                }
            }
        } else if (device === 'ios') {
            head.textContent = 'On iPhone and iPad: tap Share, then Add to Home Screen, to keep jEditor with your apps.';
        } else {
            head.textContent = 'jEditor is also an app for Windows, Mac and Linux.';
        }
        const others = document.createElement('p');
        others.className = 'start-get-others';
        const names = Object.keys(all).filter(k => k !== device);
        others.append(device in all ? 'Also for ' : 'Get it for ');
        names.forEach((k, i) => {
            if (i) others.append(i === names.length - 1 ? ' and ' : ', ');
            const a = document.createElement('a');
            a.href = all[k][0].href;
            a.rel = 'noopener';
            a.textContent = this.NAMES[k];
            others.appendChild(a);
        });
        others.append(' · ');
        const rel = document.createElement('a');
        rel.href = this.RELEASES;
        rel.target = '_blank';
        rel.rel = 'noopener';
        rel.textContent = 'All releases';
        others.appendChild(rel);
        box.appendChild(others);
        box.classList.remove('hidden');
    }
};
