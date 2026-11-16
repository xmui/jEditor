// Runs one snippet in the real page under WebKit, printing the error's stack.
const { webkit } = require('playwright-core');
const { createServer } = require('../../scripts/serve.js');
const { newPage } = require('../../test/page-helpers.js');
(async () => {
    const server = createServer(); await new Promise(r => server.listen(0, r));
    const b = await webkit.launch();
    const { page, issues } = await newPage(b, `http://localhost:${server.address().port}/index.html`);
    const code = require('fs').readFileSync(process.argv[2], 'utf8');
    try { console.log(JSON.stringify(await page.evaluate(`(async () => { try { ${code} } catch (e) { return 'THREW ' + e.name + ': ' + e.message + '\\n' + e.stack; } })()`), null, 1)); }
    catch (e) { console.log('EVAL', e.message); }
    console.log(issues.errors.slice(0, 10).join('\n'));
    await b.close(); server.close();
})();
