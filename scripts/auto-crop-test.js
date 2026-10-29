#!/usr/bin/env node
// Auto crop's test runner (docs/auto-crop-plan.md, step 2): runs today's
// Auto on every scan of a test set and scores it against the crop saved
// there, then writes a contact sheet with both crops drawn on every scan.
//
//   node scripts/auto-crop-test.js "<test set folder>" [--as editor|scan|feeder] [--boxes] [--out <folder>] [--edge <px>]
//
// The test set is a folder from Settings → Auto crop → Export… (format:
// docs/auto-crop-test-set.md). --as: which Auto, as the crop editor runs
// it (the default), or as scanning does after a flatbed (scan) or a sheet
// feeder (feeder) scan. Writes <out>/results.json and
// <out>/index.html; out is the test set's report/ folder unless given.
// --edge: the preview's long side Auto works on (the app's is the screen's,
// at least 1600). --boxes: the map-to-boxes finder with the full-detail
// refine (crop-boxes.js) in place of PhotoFind's. The scans are customers' photos: keep them, and the
// report, out of this repo.
//
// Scored against the saved crop, in mm at the scan's dpi:
//   off    the farthest corner of Auto's crop from the nearest saved one
//   extra  Auto's crop outside the saved one (bed or border left in), % of it
//   lost   the saved crop outside Auto's (photo cut off), % of it
// right: off ≤ 1 mm; close: ≤ 3 mm; wrong: more. Auto finding no print
// leaves the whole photo, and that's scored as its crop: right for a scan
// that's all print (a feeder's, cut to it), wrong where there was one.

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const { createServer } = require('./serve.js');

const RIGHT_MM = 1, CLOSE_MM = 3;
// CropAuto.find's options for each way Auto is run (script.js, scan.js)
const MODES = { editor: {}, scan: { scan: true }, feeder: { feeder: true, scan: true } };

function args() {
    const a = process.argv.slice(2);
    const opt = (name) => { const i = a.indexOf(name); return i >= 0 ? a.splice(i, 2)[1] : null; };
    const bi = a.indexOf('--boxes'), boxes = bi >= 0;
    if (boxes) a.splice(bi, 1);
    const out = opt('--out'), edge = opt('--edge'), as = opt('--as') || 'editor';
    if (a.length !== 1 || !MODES[as]) {
        console.error('Usage: node scripts/auto-crop-test.js "<test set folder>" [--as editor|scan|feeder] [--boxes] [--out <folder>] [--edge <px>]');
        process.exit(1);
    }
    return { set: path.resolve(a[0]), out: out ? path.resolve(out) : path.resolve(a[0], 'report'), edge: edge ? Number(edge) : 0, as, boxes };
}

function launchOptions() {
    const candidates = [
        process.env.CHROME_PATH,
        '/opt/pw-browsers/chromium',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
        '/usr/bin/google-chrome',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    ].filter(Boolean);
    for (const p of candidates) {
        if (fs.existsSync(p)) return { executablePath: p, args: ['--no-sandbox'] };
    }
    return { channel: 'chrome', args: ['--no-sandbox'] };
}

// The labels with a scan, the newest of each photo (a photo saved twice is
// one test: the last crop is the answer)
function labels(dir) {
    const by = new Map();
    for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.json'))) {
        let l;
        try { l = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { continue; }
        if (!l || !l.scan || !l.saved || !fs.existsSync(path.join(dir, l.scan))) continue;
        const key = `${l.project}|${l.file}`;
        if (!by.has(key) || by.get(key).at < l.at) by.set(key, l);
    }
    return [...by.values()].sort((a, b) => (a.at < b.at ? -1 : 1));
}

// ---- Geometry (convex quads, in pixels) ----

const area = (p) => Math.abs(p.reduce((s, [x, y], i) => { const [u, v] = p[(i + 1) % p.length]; return s + x * v - u * y; }, 0)) / 2;

// Sutherland–Hodgman: the part of subject inside the convex clip polygon
function clip(subject, clipper) {
    const sign = Math.sign(clipper.reduce((s, [x, y], i) => { const [u, v] = clipper[(i + 1) % clipper.length]; return s + x * v - u * y; }, 0)) || 1;
    let out = subject;
    for (let i = 0; i < clipper.length && out.length; i++) {
        const a = clipper[i], b = clipper[(i + 1) % clipper.length];
        const side = (p) => sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
        const cut = (p, q) => { const t = side(p) / (side(p) - side(q)); return [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]; };
        const input = out;
        out = [];
        for (let j = 0; j < input.length; j++) {
            const p = input[j], q = input[(j + 1) % input.length];
            if (side(q) >= 0) {
                if (side(p) < 0) out.push(cut(p, q));
                out.push(q);
            } else if (side(p) >= 0) {
                out.push(cut(p, q));
            }
        }
    }
    return out;
}

// The farthest corner of either crop from the nearest corner of the other
function apart(a, b) {
    const far = (p, q) => Math.max(...p.map(([x, y]) => Math.min(...q.map(([u, v]) => Math.hypot(x - u, y - v)))));
    return Math.max(far(a, b), far(b, a));
}

function score(label, auto) {
    const dpi = (label.dpi && typeof label.dpi === 'object' ? label.dpi.x : label.dpi) || 300;
    const mm = (px) => px * 25.4 / dpi;
    const { W, H } = label;
    const whole = [[0, 0], [W, 0], [W, H], [0, H]];
    const saved = label.saved.none ? whole : label.saved.crop;
    const crop = auto ? auto.crop : whole;
    const both = area(clip(crop, saved));
    const off = mm(apart(crop, saved));
    return {
        verdict: off <= RIGHT_MM ? 'right' : off <= CLOSE_MM ? 'close' : 'wrong',
        dpi,
        off: Math.round(off * 100) / 100,
        extra: Math.round((1 - both / area(crop)) * 1000) / 10,
        lost: Math.round((1 - both / area(saved)) * 1000) / 10
    };
}

// ---- The contact sheet ----

const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function sheet(results, summary) {
    const order = { wrong: 0, close: 1, right: 2 };
    const rows = results.slice().sort((a, b) => order[a.verdict] - order[b.verdict] || (b.off || 0) - (a.off || 0));
    const poly = (q, cls) => `<polygon class="${cls}" points="${q.map(p => p.join(',')).join(' ')}"/>`;
    const cards = rows.map(r => `
    <figure class="card ${r.verdict}">
      <svg viewBox="0 0 ${r.W} ${r.H}" role="img" aria-label="${esc(r.file)}">
        <image href="${r.thumb}" width="${r.W}" height="${r.H}"/>
        ${poly(r.saved, 'saved')}${r.auto ? poly(r.auto.crop, 'auto') : ''}
      </svg>
      <figcaption>
        <b>${esc(r.file)}</b> <span class="tag">${r.verdict}</span><br>
        off ${r.off} mm · extra ${r.extra}% · lost ${r.lost}% · ${r.auto ? esc(r.auto.finder) : 'no print found: the whole photo'}
        <br><small>${esc(r.project)} · saved ${r.label}</small>
      </figcaption>
    </figure>`).join('');
    const s = summary;
    const pct = (n) => s.n ? Math.round(n / s.n * 100) + '%' : '–';
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Auto crop test</title>
<style>
  :root { --bg: #f6f6f4; --fg: #1d1d1b; --muted: #6b6b66; --card: #ffffff; --line: #deded8;
          --saved: #12a150; --auto: #e0245e; --right: #12a150; --close: #b7791f; --wrong: #e0245e; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #161615; --fg: #ececea; --muted: #a3a39d; --card: #222220; --line: #3a3a37;
            --saved: #3ddc84; --auto: #ff5c8a; --right: #3ddc84; --close: #f0b54a; --wrong: #ff5c8a; }
  }
  body { margin: 0; padding: 24px 16px; background: var(--bg); color: var(--fg); font: 14px/1.45 system-ui, sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: var(--muted); margin: 0 0 16px; }
  .stats { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
  .stat { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; min-width: 96px; }
  .stat b { display: block; font-size: 20px; }
  .legend { color: var(--muted); margin-bottom: 16px; }
  .legend i { display: inline-block; width: 18px; height: 0; border-top: 3px solid var(--saved); vertical-align: middle; margin: 0 4px 0 12px; }
  .legend i.a { border-top: 3px dashed var(--auto); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
  .card { margin: 0; background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 8px; }
  .card svg { width: 100%; height: auto; display: block; background: #000; }
  polygon { fill: none; vector-effect: non-scaling-stroke; stroke-width: 2.5; }
  polygon.saved { stroke: var(--saved); }
  polygon.auto { stroke: var(--auto); stroke-dasharray: 6 4; }
  figcaption { margin-top: 6px; word-break: break-word; }
  small { color: var(--muted); }
  .tag { font-size: 12px; padding: 0 6px; border-radius: 4px; border: 1px solid currentColor; }
  .right .tag { color: var(--right); } .close .tag { color: var(--close); }
  .wrong .tag { color: var(--wrong); }
</style>
</head>
<body>
<h1>Auto crop test</h1>
<p class="sub">${s.n} scans · Auto as ${esc(s.as)} · jEditor ${esc(s.version)} · ${esc(s.at)} · preview ${s.edge} px</p>
<div class="stats">
  <div class="stat"><b>${s.right} <small>${pct(s.right)}</small></b>right (≤ ${RIGHT_MM} mm)</div>
  <div class="stat"><b>${s.close} <small>${pct(s.close)}</small></b>close (≤ ${CLOSE_MM} mm)</div>
  <div class="stat"><b>${s.wrong} <small>${pct(s.wrong)}</small></b>wrong</div>
  <div class="stat"><b>${s.none}</b>no print found</div>
  <div class="stat"><b>${s.medianOff ?? '–'} mm</b>median off</div>
</div>
<p class="legend">Worst first.<i></i>saved (the answer)<i class="a"></i>today's Auto</p>
<div class="grid">${cards}
</div>
</body>
</html>
`;
}

(async () => {
    const opt = args();
    const tests = labels(opt.set);
    if (!tests.length) {
        console.error(`No scans with labels in ${opt.set}`);
        process.exit(1);
    }
    const server = createServer().listen(0);
    await new Promise(r => server.once('listening', r));
    const browser = await chromium.launch(launchOptions());
    const results = [];
    let edge = 0, version = '';
    try {
        const page = await browser.newPage();
        page.on('pageerror', e => console.warn('page:', e.message));
        await page.goto(`http://localhost:${server.address().port}/index.html`, { waitUntil: 'networkidle' });
        ({ edge, version } = await page.evaluate((e) => {
            if (e) app.previewEdge = () => e;
            return { edge: app.previewEdge(), version: APP_VERSION };
        }, opt.edge));
        for (const [i, label] of tests.entries()) {
            const b64 = fs.readFileSync(path.join(opt.set, label.scan)).toString('base64');
            // Auto as the editor runs it: on the screen-sized preview,
            // straightened and cropped by the editor's own geometry
            const seen = await page.evaluate(async ([b64, opts]) => {
                const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
                const { bmp, W, H } = await CropLog.sight(new Blob([bytes], { type: 'image/jpeg' }));
                try {
                    const det = CropAuto.find(bmp, W, H, opts);
                    let auto = null;
                    if (det) {
                        const ed = CropEditor.headless(W, H);
                        ed.aspectKey = 'free';
                        ed.fitToPrint(det);
                        auto = CropLog.autoOf(ed, det);
                    }
                    const k = Math.min(1, 520 / Math.max(bmp.width, bmp.height));
                    const c = document.createElement('canvas');
                    c.width = Math.round(bmp.width * k);
                    c.height = Math.round(bmp.height * k);
                    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
                    return { W, H, auto, thumb: c.toDataURL('image/jpeg', 0.8) };
                } finally {
                    bmp.close();
                }
            }, [b64, { ...MODES[opt.as], boxes: opt.boxes }]);
            if (seen.W !== label.W || seen.H !== label.H) {
                console.warn(`  ${label.scan}: the scan is ${seen.W}×${seen.H}, its label says ${label.W}×${label.H}; skipped`);
                continue;
            }
            const s = score(label, seen.auto);
            results.push({
                scan: label.scan, file: label.file, project: label.project, label: label.result,
                W: label.W, H: label.H, saved: label.saved.none ? [[0, 0], [label.W, 0], [label.W, label.H], [0, label.H]] : label.saved.crop,
                auto: seen.auto, thumb: seen.thumb, ...s
            });
            const r = results[results.length - 1];
            console.log(`${String(i + 1).padStart(3)}/${tests.length} ${r.verdict.padEnd(6)} off ${String(r.off).padStart(6)} mm  extra ${String(r.extra).padStart(5)}%  lost ${String(r.lost).padStart(5)}%  ${(r.auto ? r.auto.finder : 'none').padEnd(8)} ${label.file}`);
        }
    } finally {
        await browser.close();
        server.close();
    }

    const count = (v) => results.filter(r => r.verdict === v).length;
    const offs = results.map(r => r.off).sort((a, b) => a - b);
    const summary = {
        at: new Date().toISOString(), version, edge, as: opt.as + (opt.boxes ? ' (boxes)' : ''), n: results.length,
        right: count('right'), close: count('close'), wrong: count('wrong'), none: results.filter(r => !r.auto).length,
        medianOff: offs.length ? offs[Math.floor(offs.length / 2)] : null
    };
    fs.mkdirSync(opt.out, { recursive: true });
    fs.writeFileSync(path.join(opt.out, 'results.json'), JSON.stringify({ summary, results: results.map(({ thumb, ...r }) => r) }, null, 1));
    fs.writeFileSync(path.join(opt.out, 'index.html'), sheet(results, summary));
    console.log(`\n${summary.n} scans: ${summary.right} right, ${summary.close} close, ${summary.wrong} wrong (no print found on ${summary.none}); median off ${summary.medianOff} mm`);
    console.log(`Contact sheet: ${path.join(opt.out, 'index.html')}`);
})().catch(e => { console.error(e); process.exit(1); });
