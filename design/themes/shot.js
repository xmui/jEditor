// node shot.js <out-prefix> [theme.css ...]  — screenshots the real app, themed
const path = require('path'), fs = require('fs'), http = require('http');
const REPO = path.resolve(__dirname, '../..');
const { chromium } = require(REPO + '/node_modules/playwright-core');
const { launchOptions } = require(REPO + '/test/page-helpers.js');
const PH = path.join(__dirname, 'photos');
const [out, themeDir] = process.argv.slice(2);
const css = [], js = [];
if (themeDir) {
    const T = path.resolve(themeDir);
    const cfg = fs.existsSync(T + '/theme.json') ? JSON.parse(fs.readFileSync(T + '/theme.json')) : {};
    if ((cfg.layout || '').includes('docked')) css.push(path.join(__dirname, 'docked.css'));
    const bases = [].concat(cfg.base || []);
    for (const b of bases) css.push(path.resolve(T, b, 'theme.css'));
    css.push(T + '/theme.css');
    js.push(path.join(__dirname, 'parts.js'));
    const own = fs.existsSync(T + '/setup.js') ? T + '/setup.js' : bases.map(b => path.resolve(T, b, 'setup.js')).reverse().find(f => fs.existsSync(f));
    if (own) js.push(own);
}
const views = (process.env.VIEWS || 'grid,photo').split(',');
const names = ['Coast road.jpg','Harbour at dusk.jpg','Old bridge.jpg','Morning fog.jpg','Pine forest.jpg','Lighthouse.jpg','Kitchen window.jpg','Market.jpg','Dunes.jpg','Grandad.jpg','Allotment.jpg','Lake.jpg','Snow line.jpg','Back garden.jpg','Station.jpg','Cliffs.jpg','Rain.jpg','Pier.jpg','Valley.jpg','Field.jpg'];
const files = fs.readdirSync(PH).filter(f => f.endsWith('.jpg')).sort();
const srv = http.createServer((req, res) => {
    let u = decodeURIComponent(req.url.split('?')[0]);
    let p = u.startsWith('/photos/') ? path.join(PH, u.slice(8)) : u.startsWith('/theme/') ? u.slice(6) : path.join(REPO, 'app', u.endsWith('/') ? u + 'index.html' : u);
    fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); return res.end(); }
        const ext = path.extname(p); res.writeHead(200, { 'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.json': 'application/json' }[ext] || 'application/octet-stream' }); res.end(d); });
});
(async () => {
    await new Promise(r => srv.listen(0, r));
    const base = `http://localhost:${srv.address().port}`;
    const browser = await chromium.launch(launchOptions());
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: Number(process.env.DPR || 1) });
    page.on('pageerror', e => console.log('ERR', e.message));
    await page.goto(base + '/index.html' + (process.env.Q || ''));
    for (const c of css) await page.addStyleTag({ url: base + '/theme' + path.resolve(c) });
    for (const j of js) await page.addScriptTag({ url: base + '/theme' + j });
    await page.evaluate(async ({ files, names }) => {
        if (window.__pre) await window.__pre();
        const root = await navigator.storage.getDirectory();
        try { await root.removeEntry('Summer 2024', { recursive: true }); } catch (e) {}
        const dir = await root.getDirectoryHandle('Summer 2024', { create: true });
        const subs = { 'Coast trip': [0, 1, 5, 8, 15, 17], 'Garden': [10, 13] };
        const where = {}; for (const [k, v] of Object.entries(subs)) for (const i of v) where[i] = k;
        for (let i = 0; i < files.length; i++) {
            const b = await (await fetch('/photos/' + files[i])).blob();
            const d = where[i] ? await dir.getDirectoryHandle(where[i], { create: true }) : dir;
            const w = await (await d.getFileHandle(names[i] || files[i], { create: true })).createWritable(); await w.write(b); await w.close();
        }
        window.showDirectoryPicker = async () => dir;
        await app.browseFolder();
        while (app.files.some(f => !f.thumbnailUrl)) await new Promise(r => setTimeout(r, 50));
    }, { files, names });
    if (process.env.HTMLCLASS) await page.evaluate(c => document.documentElement.classList.add(...c.split(' ')), process.env.HTMLCLASS);
    await page.waitForTimeout(600);
        if (process.env.PRE) await page.evaluate(process.env.PRE);
    await page.evaluate(() => document.getElementById('btn-toggle-view').click()); await page.waitForTimeout(400);
    if (!(await page.isVisible('#folder-rail'))) { await page.keyboard.press('Control+b'); await page.waitForTimeout(300); }
    await page.evaluate(() => { const it = document.querySelectorAll('#grid-view .grid-item'); [[1, false], [2, true], [6, true]].forEach(([i, c]) => { for (const t of ['mousedown', 'mouseup', 'click']) it[i].dispatchEvent(new MouseEvent(t, { bubbles: true, ctrlKey: c, button: 0 })); }); });
    await page.mouse.move(5, 400); await page.waitForTimeout(Number(process.env.WAIT || 700));
    if (views.includes('grid')) await page.screenshot({ path: `${out}-grid.png` });
    if (process.env.DUMPGRID) console.log(await page.evaluate(process.env.DUMPGRID));
    await page.evaluate(() => document.getElementById('btn-toggle-view').click()); await page.waitForTimeout(300);
    if (views.includes('photo')) {
        await page.evaluate(() => app.openSingle(app.files[3]));
        await page.waitForTimeout(1200);
        await page.screenshot({ path: `${out}-photo.png` });
    }
    if (process.env.DUMP) console.log(await page.evaluate(process.env.DUMP));
    if (process.env.HOLD) await page.waitForTimeout(1e9);
    await browser.close(); srv.close();
})();
