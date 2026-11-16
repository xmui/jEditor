// Like probe.js but in a persistent WebKit profile (as a real app has).
const { webkit } = require('playwright-core');
const { createServer } = require('../../scripts/serve.js');
const fs = require('fs'), os = require('os'), path = require('path');
(async () => {
    const server = createServer(); await new Promise(r => server.listen(0, r));
    const ctx = await webkit.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'wk-')), {});
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${server.address().port}/index.html`);
    const code = fs.readFileSync(process.argv[2], 'utf8');
    console.log(JSON.stringify(await page.evaluate(`(async () => { ${code} })()`), null, 1));
    await ctx.close(); server.close();
})();
