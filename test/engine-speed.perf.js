// Times what the fast engine is meant to speed up after the thumbnails
// (docs/plans/fast-engine.md, Phase 0): Adjust at full size (the tables,
// Detail, the export path), JPEG encode and decode at 24 MP, and Paint's
// brush, undo snapshot and compositing on a 3000 px layer. In Chrome or
// Edge (the engine WebView2 and Electron are), on this computer's own GPU.
// Not part of npm test: run it by hand, before and after an engine phase.
//
//   node test/engine-speed.perf.js
//   CHROME_PATH=<a Chrome or Edge> node test/engine-speed.perf.js
//   JSON=out.json node test/engine-speed.perf.js     (the numbers, kept)

const fs = require('fs');
const { chromium } = require('playwright-core');
const { createServer } = require('../scripts/serve.js');
const { launchOptions } = require('./page-helpers');

async function main() {
    const server = createServer();
    await new Promise(r => server.listen(39611, r));
    const o = launchOptions();
    // Headed: a real GPU (headless Chrome may draw WebGL on the CPU)
    const browser = await chromium.launch({ executablePath: o.executablePath, channel: o.channel, args: o.args, headless: !!process.env.HEADLESS });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto('http://localhost:39611/', { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof Develop !== 'undefined');
    const r = await page.evaluate(async () => {
        const out = {};
        const t = async (k, f, n = 1) => {
            const ts = [];
            for (let i = 0; i < n; i++) { const a = performance.now(); await f(i); ts.push(performance.now() - a); }
            ts.sort((x, y) => x - y);
            out[k] = Math.round(ts[Math.floor(ts.length / 2)]);
        };
        const gl = document.createElement('canvas').getContext('webgl2');
        const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
        out.gpu = gl ? (dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'WebGL2') : 'none';
        // A 24 MP photo: a gradient with coloured squares
        const W = 6000, H = 4000;
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const g = c.getContext('2d', { willReadFrequently: true });
        const gr = g.createLinearGradient(0, 0, W, H);
        gr.addColorStop(0, '#345'); gr.addColorStop(0.5, '#c96'); gr.addColorStop(1, '#2a8');
        g.fillStyle = gr; g.fillRect(0, 0, W, H);
        for (let i = 0; i < 4000; i++) { g.fillStyle = `hsl(${i * 37 % 360},60%,${30 + i % 50}%)`; g.fillRect((i * 7919) % W, (i * 104729) % H, 40, 40); }
        let jpeg = null;
        await t('JPEG encode, 24 MP', async () => { jpeg = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92)); }, 3);
        await t('JPEG decode, 24 MP', async () => { (await createImageBitmap(jpeg)).close(); }, 3);
        await t('JPEG decode to a 320 px thumbnail, 24 MP', async () => { (await createImageBitmap(jpeg, { resizeWidth: 320, resizeQuality: 'medium' })).close(); }, 3);
        const adj = { exposure: 0.4, contrast: 20, highlights: -30, shadows: 25, vibrance: 20, saturation: 10, hsl: { hue: [5, 0, 0, 0, 0, 0, 0, 0], sat: [0, 10, 0, 0, 0, 0, 0, 0], lum: [0, 0, 0, 0, 0, 0, 0, 0] }, grade: { s: [200, 20, 0], m: [0, 0, 0], h: [40, 15, 0] } };
        await t('Adjust: the tables for one slider step', (i) => { Develop.tables({ ...adj, saturation: 10 + i }); }, 9);
        const masks = [0, 1, 2, 3].map(k => ({ type: 'radial', radial: [0.5, 0.5, 0.3, 0.2, 0, 50], adj: { exposure: 0.2 + k * 0.1 } }));
        await t('Adjust: the tables with 4 masks', (i) => { Develop.tables({ ...adj, saturation: 30 + i, masks: masks.map(m => ({ ...m, adj: { ...m.adj, saturation: i } })) }); }, 9);
        const px = g.getImageData(0, 0, W, H).data;
        await t('Adjust: the tables on the CPU, 24 MP (no WebGL2)', () => Develop.applyCPU(px, Develop.tables(adj), new Uint8ClampedArray(px.length), { x: 0, y: 0, w: W, W, H }), 2);
        const a2 = { ...adj, sharpen: 60, sharpRadius: 1, sharpMask: 20, noise: 30, colorNoise: 30 };
        const d = Develop.detail(Develop.full(a2));
        const block = px.slice(0, 2048 * 2048 * 4);
        await t('Adjust: Detail on a 2048² block (CPU)', () => Develop.applyDetail(new Uint8ClampedArray(block), 2048, 2048, d, 1), 2);
        const e = document.createElement('canvas'); e.width = W; e.height = H;
        e.getContext('2d').drawImage(c, 0, 0);
        await t('Export path: adjustments on 24 MP (applyCanvas)', () => Develop.applyCanvas(e, adj, { scale: 1 }), 2);
        await t('Export path: with Detail, 24 MP', () => Develop.applyCanvas(e, a2, { scale: 1 }), 1);
        // Paint: a 3000² layer (Paint's cap)
        const L = document.createElement('canvas'); L.width = L.height = 3000;
        const lg = L.getContext('2d');
        await t('Paint: a stroke of 200 soft dabs, radius 60', () => {
            for (let i = 0; i < 200; i++) {
                const x = 300 + i * 12, y = 1500 + Math.sin(i / 10) * 400;
                const gg = lg.createRadialGradient(x, y, 30, x, y, 60);
                gg.addColorStop(0, 'rgba(200,40,40,.5)'); gg.addColorStop(1, 'rgba(200,40,40,0)');
                lg.fillStyle = gg; lg.beginPath(); lg.arc(x, y, 60, 0, 7); lg.fill();
            }
            lg.getImageData(0, 0, 1, 1);
        }, 3);
        await t('Paint: undo snapshot of a long stroke (2600×1000, twice)', () => { lg.getImageData(200, 1000, 2600, 1000); lg.getImageData(200, 1000, 2600, 1000); }, 3);
        await t('Paint: three 3000² layers composited', () => {
            const o = document.createElement('canvas'); o.width = o.height = 3000;
            const og = o.getContext('2d');
            for (let k = 0; k < 3; k++) og.drawImage(L, 0, 0);
            og.getImageData(0, 0, 1, 1);
        }, 3);
        return out;
    });
    console.log(`\n== engine speed (${r.gpu}) ==`);
    for (const [k, v] of Object.entries(r)) if (k !== 'gpu') console.log(`  ${k.padEnd(58)} ${v} ms`);
    if (process.env.JSON) fs.writeFileSync(process.env.JSON, JSON.stringify(r, null, 1));
    await browser.close();
    server.close();
}

main().catch(e => { console.error(e); process.exit(1); });
