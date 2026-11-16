// Step 0: how long each engine takes to load jEditor's page (no shell), median of 5.
const pw = require('playwright-core');
const fs = require('fs'), os = require('os'), path = require('path');
const { createServer } = require('../../scripts/serve.js');
const { launchOptions } = require('../../test/page-helpers.js');
(async () => {
    const server = createServer(); await new Promise(r => server.listen(0, r));
    const url = `http://localhost:${server.address().port}/index.html`;
    for (const engine of ['chromium', 'webkit']) {
        const ts = [];
        for (let i = 0; i < 5; i++) {
            const ctx = engine === 'webkit'
                ? await pw.webkit.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'wk-')))
                : await pw.chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'cr-')), launchOptions());
            const page = ctx.pages()[0] || await ctx.newPage();
            await page.goto(url, { waitUntil: 'load' });
            ts.push(await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; return { load: Math.round(n.loadEventEnd), script: Math.round(n.domContentLoadedEventEnd - n.responseEnd) }; }));
            await ctx.close();
        }
        const med = (k) => ts.map(t => t[k]).sort((a, b) => a - b)[2];
        console.log(engine, 'load event', med('load'), 'ms; parse+run scripts', med('script'), 'ms');
    }
    server.close();
})();
