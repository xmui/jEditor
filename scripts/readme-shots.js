#!/usr/bin/env node
// The README's screenshots (docs/images/): the real desktop app (the
// Electron one, mac/), driven by Playwright, at 1280×800 and twice the
// pixels, in light and dark: the grid, the viewer, Convert, Adjust and Paint (and
// Home, when asked for).
// The photos are Unsplash's, from Lorem Picsum (downloaded to a temp folder).
//
//   npm ci && (cd mac && npm ci)
//   node scripts/readme-shots.js [grid|viewer|adjust|paint|home …]   (Linux: xvfb-run -a)
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '..'), MAC = path.join(ROOT, 'mac');
const { _electron: electron } = require('playwright-core');
const { QUIET_FIRST_OPEN } = require('../test/page-helpers.js');
const ELECTRON = require(path.join(MAC, 'node_modules', 'electron'));
const OUT = path.join(ROOT, 'docs', 'images'), only = process.argv.slice(2);
const W = 1280, H = 800;
// Lorem Picsum's ids, in the order they're named below
const IDS = [10, 1015, 1016, 1018, 1019, 1025, 1036, 1039, 1043, 1044, 1047, 1050, 1069, 1080, 11, 110, 28, 29, 42];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jeditor-readme-'));
const SP = tmp;
const projects = path.join(tmp, 'Photos');
const trip = path.join(projects, 'Summer trip');
fs.mkdirSync(path.join(trip, 'Coast'), { recursive: true });
fs.mkdirSync(path.join(projects, 'Family'), { recursive: true });
fs.mkdirSync(path.join(projects, 'Scans 1998'), { recursive: true });
fs.mkdirSync(path.join(SP, 'photos'));
const pics = IDS.map(id => `p${id}.jpg`);
async function download() {
    for (const id of IDS) {
        const res = await fetch(`https://picsum.photos/id/${id}/1800/1200`);
        if (!res.ok) throw new Error(`photo ${id}: ${res.status}`);
        fs.writeFileSync(path.join(SP, 'photos', `p${id}.jpg`), Buffer.from(await res.arrayBuffer()));
    }
}
const names = ['Forest', 'Fjord', 'Canyon', 'Pass', 'Storm', 'Pug', 'Camp', 'Falls', 'Valley', 'River', 'Alley', 'Cliffs', 'Jellyfish', 'Strawberries', 'Lake', 'Sunset', 'Greenwood', 'Peaks', 'Cafe'];


async function launch(args) {
    const app = await electron.launch({
        executablePath: ELECTRON,
        args: [MAC, '--no-sandbox', '--force-device-scale-factor=2', '--user-data', path.join(tmp, 'profile'), ...args],
        env: { ...process.env, JEDITOR_SKIP_PERMISSIONS: '1' }
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForFunction(() => typeof app !== 'undefined' && app.elements && window.JEditorNative);
    await page.evaluate(QUIET_FIRST_OPEN);
    await app.evaluate(({ BrowserWindow }, [w, h]) => { const b = BrowserWindow.getAllWindows()[0]; b.setContentSize(w, h); b.center(); }, [W, H]);
    return { app, page, errors };
}
const shot = async (page, name, clip) => {
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(OUT, name + '.jpg'), type: 'jpeg', quality: 82, ...(clip ? { clip } : {}) });
    console.log('shot', name);
};
const theme = (page, t) => page.evaluate((t) => { app.uiPrefs.theme = t; app.applyAppearance(); }, t);

const tidy = async (page) => {
    await page.evaluate(() => { document.querySelectorAll('.toast').forEach(t => t.remove()); });
    await page.mouse.move(2, 2);
};
const byName = (n) => `app.files.find(f => f.name.includes(${JSON.stringify(n)}))`;

(async () => {
    await download();
    pics.forEach((f, i) => fs.copyFileSync(path.join(SP, 'photos', f), path.join(i < 15 ? trip : path.join(trip, 'Coast'), `${String(i + 1).padStart(2, '0')} ${names[i] || f}.jpg`)));
    for (const [d, n] of [['Family', 4], ['Scans 1998', 3]]) for (let i = 0; i < n; i++) fs.copyFileSync(path.join(SP, 'photos', pics[i + 5]), path.join(projects, d, `img${i}.jpg`));
    const { app: el, page, errors } = await launch([trip]);
    await page.waitForFunction(() => !app.isLoading && app.files.length >= 15, null, { timeout: 30000 });
    await page.evaluate(async (dir) => {
        Places.set(Places.KEY_DIR, dir);
        await Places.refresh();
        for (const n of ['Fjord', 'Falls', 'Sunset']) Flags.apply('star', [app.files.find(f => f.name.includes(n))]);
        app.clearSelection();
        app.setGridSize(150);
    }, projects);
    const want = (n) => only.length ? only.includes(n) : n !== 'home'; // (home: only when asked)
    for (const t of ['light', 'dark']) {
        await theme(page, t);
        if (want('grid')) {
            await page.evaluate(() => { app.setView('grid'); app.clearSelection(); });
            await tidy(page);
            await shot(page, `grid-${t}`);
        }
        if (want('viewer')) {
            await page.evaluate((s) => app.openSingle(eval(s)), byName('Fjord'));
            await tidy(page);
            await shot(page, `viewer-${t}`);
        }
        if (want('paint')) {
            await page.evaluate(async (s) => {
                app.openSingle(eval(s));
                await app.enterPaint();
                const until = async (fn) => { for (let k = 0; k < 300 && !fn(); k++) await new Promise(r => setTimeout(r, 50)); };
                await until(() => PaintEditor.ready);
                const P = PaintEditor;
                P.opts.snap = false;
                // A painted layer: soft brush strokes of warm light
                const l = P.layers.find(k => !k.fixed && !k.text) || (P.addLayer(), P.layer()), g = l.canvas.getContext('2d');
                g.save();
                const W = P.W, H = P.H;
                const rg = g.createRadialGradient(W * 0.72, H * 0.3, 10, W * 0.72, H * 0.3, W * 0.25);
                rg.addColorStop(0, 'rgba(255,200,120,0.75)'); rg.addColorStop(1, 'rgba(255,170,80,0)');
                g.fillStyle = rg; g.fillRect(0, 0, W, H);
                g.restore();
                l.name = 'Glow';
                P.drawLayers && P.drawLayers();
                // A text layer
                const st = document.getElementById('paint-stage'), ta = document.getElementById('paint-text');
                const sc = (q) => { const sp = P.V().transformPoint(q); const rr = P.canvas.getBoundingClientRect(); return { clientX: rr.left + sp.x, clientY: rr.top + sp.y }; };
                P.setTool('text');
                Object.assign(P.opts, { fontSize: Math.round(H * 0.11), bold: true, italic: false, opacity: 100, outline: 0, align: 'left', font: 'system-ui, sans-serif' });
                P.fg = '#ffffff';
                const q = { x: W * 0.08, y: H * 0.68 };
                st.dispatchEvent(new PointerEvent('pointerdown', { ...sc(q), pointerId: 1, bubbles: true, button: 0 }));
                st.dispatchEvent(new PointerEvent('pointerup', { ...sc(q), pointerId: 1, bubbles: true }));
                await new Promise(r => setTimeout(r, 50));
                ta.value = 'Summer 2026';
                ta.dispatchEvent(new Event('input'));
                ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
                await new Promise(r => setTimeout(r, 50));
                P.setTool('brush');
                P.renderSoon && P.renderSoon();
            }, byName('Lake'));
            await page.waitForTimeout(1200);
            await tidy(page);
            await shot(page, `paint-${t}`);
            await page.evaluate(async () => { await app.cancelPaint(); });
            await page.waitForTimeout(500);
        }
        if (want('convert')) {
            await page.evaluate(() => { app.setView('grid'); app.clearSelection(); Convert.open({}); });
            // (its storage, worked out from a sample, and the close-up)
            await page.waitForFunction(() => { const a = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && /^After$/.test(e.textContent.trim())); const o = [...document.querySelectorAll('*')].find(e => e.children.length === 0 && /^Original$/.test(e.textContent.trim())); return a && o && a.parentElement.textContent !== o.parentElement.textContent.replace('Original', 'After'); }, null, { timeout: 30000 }).catch(() => { });
            await page.waitForTimeout(1500);
            await tidy(page);
            // The window down to its quality slider: these sample photos
            // are squeezed hard already, so the sizes under it would
            // undersell what it saves on a camera's photos
            const clip = await page.evaluate(() => {
                const leaf = (t) => [...document.querySelectorAll('body *')].filter(e => e.children.length === 0 && e.textContent.trim() === t && e.getClientRects().length).map(e => e.getBoundingClientRect());
                const small = leaf('Smaller')[0], better = leaf('Better')[0];
                const title = leaf('Convert').filter(r => r.bottom < small.top && r.left < small.left + 40).sort((a, b) => b.top - a.top).pop();
                const x = small.left - 28, y = title.top - 28;
                return { x, y, width: better.right + 44 - x, height: small.bottom + 14 - y };
            });
            await shot(page, `convert-${t}`, clip);
            await page.keyboard.press('Escape');
            await page.waitForTimeout(400);
        }
        if (want('adjust')) {
            await page.evaluate(async (s) => { app.openSingle(eval(s)); await app.enterAdjust(); }, byName('Falls'));
            await page.waitForTimeout(1500);
            await tidy(page);
            await shot(page, `adjust-${t}`);
            await page.evaluate(async () => { if (app.cancelAdjust) await app.cancelAdjust(); else if (typeof Modes !== 'undefined') await Modes.go('photos'); });
        }
    }
    for (const t of ['light', 'dark']) {
        await theme(page, t);
        if (want('home')) {
            await page.evaluate(() => app.showHome());
            await tidy(page);
            await shot(page, `home-${t}`);
        }
    }
    console.log('errors', errors);
    await el.close();
    fs.rmSync(tmp, { recursive: true, force: true });
})().catch(e => { console.error(e); process.exit(1); });
