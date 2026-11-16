#!/usr/bin/env node
// Step 0: a 600 dpi A4 scan (4960×7016, 35 MP) in Chromium or WebKit:
// decode, the scaled thumbnail, Adjust's export path, and the canvas limits
// that Paint's layers (3000² each, Paint's cap) run into.
//   node spike/desktop/bigscan.js chromium|webkit
const pw = require('playwright-core');
const fs = require('fs'), os = require('os'), path = require('path');
const { createServer } = require('../../scripts/serve.js');
const { launchOptions } = require('../../test/page-helpers.js');
(async () => {
    const engine = process.argv[2] || 'chromium';
    const server = createServer(); await new Promise(r => server.listen(0, r));
    const ctx = engine === 'webkit'
        ? await pw.webkit.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'wk-')), { viewport: { width: 1440, height: 900 } })
        : await (await pw.chromium.launch(launchOptions())).newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${server.address().port}/`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => typeof Develop !== 'undefined');
    const r = await page.evaluate(async () => {
        const out = {};
        const t = async (k, f, n = 3) => {
            const ts = [];
            for (let i = 0; i < n; i++) { const a = performance.now(); try { await f(i); } catch (e) { out[k] = 'FAILS: ' + e.name + ' ' + e.message; return; } ts.push(performance.now() - a); }
            ts.sort((x, y) => x - y); out[k] = Math.round(ts[Math.floor(ts.length / 2)]) + ' ms';
        };
        const W = 4960, H = 7016;
        const c = document.createElement('canvas'); c.width = W; c.height = H;
        const g = c.getContext('2d');
        const gr = g.createLinearGradient(0, 0, W, H); gr.addColorStop(0, '#f4efe4'); gr.addColorStop(1, '#d9cdb5');
        g.fillStyle = gr; g.fillRect(0, 0, W, H);
        for (let i = 0; i < 3000; i++) { g.fillStyle = `hsl(${i * 37 % 360},50%,${30 + i % 50}%)`; g.fillRect((i * 7919) % W, (i * 104729) % H, 60, 60); }
        let jpeg;
        await t('encode 35 MP JPEG', async () => { jpeg = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92)); }, 2);
        out['JPEG size'] = (jpeg.size / 1e6).toFixed(1) + ' MB';
        await t('decode 35 MP (createImageBitmap)', async () => (await createImageBitmap(jpeg)).close());
        await t('320 px thumbnail (createImageBitmap resize)', async () => (await createImageBitmap(jpeg, { resizeWidth: 320, resizeQuality: 'medium' })).close());
        if (typeof ImageDecoder !== 'undefined') {
            await t('ImageDecoder, asked for 1/8 size', async () => {
                const d = new ImageDecoder({ data: await jpeg.arrayBuffer(), type: 'image/jpeg', desiredWidth: W / 8, desiredHeight: H / 8 });
                const { image } = await d.decode(); out['ImageDecoder gives'] = image.codedWidth + '×' + image.codedHeight + (typeof image.rotation === 'number' ? '' : ' (no rotation)'); image.close(); d.close();
            });
            out['ImageDecoder with file.stream()'] = await Promise.race([
                (async () => { const d = new ImageDecoder({ data: jpeg.stream(), type: 'image/jpeg' }); const { image } = await d.decode(); image.close(); return 'works'; })().catch(e => 'fails: ' + e.name),
                new Promise(r => setTimeout(() => r('never answers (10 s)'), 10000))]);
        } else out.ImageDecoder = 'none';
        const adj = { exposure: 0.4, contrast: 20, highlights: -30, shadows: 25, vibrance: 20, saturation: 10 };
        await t('Adjust export path on 35 MP (applyCanvas)', () => Develop.applyCanvas(c, adj, { scale: 1 }), 2);
        await t('Adjust export path with Detail, 35 MP', () => Develop.applyCanvas(c, { ...adj, sharpen: 60, sharpRadius: 1, noise: 30 }, { scale: 1 }), 1);
        // Paint: 3000² layers kept alive, until one can't be drawn or read
        const layers = []; let n = 0;
        for (; n < 80; n++) {
            const L = document.createElement('canvas'); L.width = L.height = 3000;
            const lg = L.getContext('2d'); if (!lg) break;
            lg.fillStyle = '#' + (n * 1234567 % 0xffffff).toString(16).padStart(6, '0'); lg.fillRect(0, 0, 3000, 3000);
            let px; try { px = lg.getImageData(1500, 1500, 1, 1).data; } catch (e) { break; }
            if (px[3] === 0) break;
            layers.push(L);
        }
        out['3000² layers before one fails (of 80 tried)'] = n;
        layers.length = 0;
        for (const s of [8192, 11000, 16384]) {
            const k = document.createElement('canvas'); k.width = k.height = s; const kg = k.getContext('2d');
            let ok = false; try { kg.fillRect(0, 0, 1, 1); ok = kg.getImageData(0, 0, 1, 1).data[3] === 255; } catch (e) { }
            out[`one ${s}² canvas`] = ok ? 'ok' : 'fails'; k.width = k.height = 0;
        }
        return out;
    });
    console.log(`== ${engine} ==`);
    for (const [k, v] of Object.entries(r)) console.log(`  ${k.padEnd(46)} ${v}`);
    await ctx.close(); server.close(); process.exit(0);
})();
