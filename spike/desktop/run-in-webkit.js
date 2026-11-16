#!/usr/bin/env node
// Step 0 of docs/plans/lighter-desktop.md: run a browser suite (default
// test/ui.test.js) unchanged, in Playwright's WebKit instead of Chromium.
// The suites already give the page in-memory folder handles (page-helpers.js),
// so this is the page on WebKit with a stub of the handles.
//   node spike/desktop/run-in-webkit.js [test/ui.test.js]
const Module = require('module');
const path = require('path');
const real = require('playwright-core');
const origLoad = Module._load;
Module._load = function (req, parent, isMain) {
    const m = origLoad.apply(this, arguments);
    if (req === 'playwright-core') {
        return new Proxy(m, { get: (t, k) => k === 'chromium' ? wrap(real.webkit) : t[k] });
    }
    return m;
};
function wrap(wk) {
    return new Proxy(wk, { get: (t, k) => k === 'launch' ? () => fakeBrowser(t) : (typeof t[k] === 'function' ? t[k].bind(t) : t[k]) });
}
// Playwright's WebKit has no OPFS in its throwaway profiles (UnknownError);
// a real app has a persistent one, where it works. So every page the suite
// asks for gets a fresh persistent profile of its own.
const fs = require('fs'), os = require('os');
async function fakeBrowser(wk) {
    const contexts = new Set();
    const newPage = async (opts = {}) => {
        const ctx = await wk.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'wk-')), opts);
        contexts.add(ctx);
        const proto = Object.getPrototypeOf(ctx);
        // CDP is Chromium only: a do-nothing session (those checks then fail on their own)
        proto.newCDPSession = async () => ({ send: async () => ({}), on() {}, detach: async () => {} });
        // WebKit knows clipboard-read but not clipboard-write
        if (!proto.__gp) { const gp = proto.grantPermissions; proto.grantPermissions = function (perms, o) { return gp.call(this, perms.filter(x => x !== 'clipboard-write'), o); }; proto.__gp = 1; }
        const page = ctx.pages()[0] || await ctx.newPage();
        patchEvaluate(Object.getPrototypeOf(page));
        const close = page.close.bind(page);
        page.close = async () => { await close().catch(() => {}); contexts.delete(ctx); await ctx.close().catch(() => {}); };
        return page;
    };
    const b = {
        newPage,
        newContext: async (opts) => { let pg; return { newPage: async () => (pg = await newPage(opts)), close: async () => pg && pg.close(), pages: () => (pg ? [pg] : []) }; },
        close: async () => { for (const c of contexts) await c.close().catch(() => {}); },
        version: () => 'webkit', contexts: () => [...contexts], isConnected: () => true,
    };
    return b;
}
// A section whose page.evaluate throws would stop the whole suite. Instead it's
// logged as a FAIL with the page's own stack, and the section gets a stand-in
// result that never throws (its checks then mostly fail, which is the point).
function hollow() {
    const f = function () { return hollow(); };
    return new Proxy(f, { get: (t, k) => k === 'then' || k === 'toJSON' ? undefined : k === Symbol.toPrimitive ? () => '' : k === Symbol.iterator ? function* () {} : k === 'length' ? 0 : hollow(), apply: () => hollow() });
}
let patched = false;
function patchEvaluate(proto) {
    if (patched) return; patched = true;
    const orig = proto.evaluate;
    proto.evaluate = async function (fn, arg) {
        let src = fn;
        if (typeof fn === 'function') {
            let json; try { json = JSON.stringify(arg); } catch (e) { json = null; }
            if (json !== null && json !== undefined || arg === undefined) {
                src = `(async () => { try { return await (${fn})(${arg === undefined ? '' : json}); } catch (e) { throw new Error((e && e.name) + ': ' + (e && e.message) + ' @@ ' + String(e && e.stack).split('\\n').slice(0, 4).join(' | ')); } })()`;
            } else src = null;
        }
        try { return src === null ? await orig.call(this, fn, arg) : await orig.call(this, src); }
        catch (e) {
            if (/closed/.test(e.message)) throw e;
            const where = (new Error().stack.split('\n').find(l => /test\.js:\d+/.test(l)) || '').trim().replace(/.*\//, '');
            console.log(`  FAIL  (threw at ${where}) ${e.message.split('\n')[0].replace(/^page\.evaluate: (Error: )?/, '')}`);
            return hollow();
        }
    };
}
process.on('unhandledRejection', e => { console.log('  FAIL  (unhandled) ' + String(e && e.message || e).split('\n')[0]); });
require(path.resolve(process.argv[2] || path.join(__dirname, '../../test/ui.test.js')));
