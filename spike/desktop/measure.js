#!/usr/bin/env node
// Step 0: start time and memory of the Tauri spike against the real Electron
// app, both showing jEditor's start screen (no folder: the spike has no host
// calls yet). Linux, under Xvfb. Prints a median of N runs.
//   node spike/desktop/measure.js <electron binary> [runs]
const { spawn, execSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const ROOT = path.join(__dirname, '../..');
const ELECTRON = process.argv[2];
const RUNS = +(process.argv[3] || 5);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function tree(pid) {
    const kids = {};
    for (const d of fs.readdirSync('/proc')) {
        if (!/^\d+$/.test(d)) continue;
        try { const pp = +fs.readFileSync(`/proc/${d}/stat`, 'utf8').split(') ')[1].split(' ')[1]; (kids[pp] ||= []).push(+d); } catch (e) { }
    }
    const out = [pid];
    for (let i = 0; i < out.length; i++) out.push(...(kids[out[i]] || []));
    return out;
}
// Proportional set size (shared pages split between processes), in MB
function pss(pids) {
    let kb = 0;
    for (const p of pids) {
        try { const m = fs.readFileSync(`/proc/${p}/smaps_rollup`, 'utf8').match(/^Pss:\s+(\d+)/m); if (m) kb += +m[1]; } catch (e) { }
    }
    return kb / 1024;
}

async function once(cmd, args, env) {
    const t0 = Date.now();
    const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let loaded = null, out = '';
    p.stdout.on('data', d => { out += d; const m = /LOADED (\d+)/.exec(out); if (m && !loaded) loaded = +m[1]; });
    p.stderr.on('data', () => { });
    for (let i = 0; i < 300 && !loaded; i++) await sleep(50);
    await sleep(8000); // idle
    const pids = tree(p.pid);
    const mem = pss(pids);
    try { process.kill(-p.pid); } catch (e) { }
    for (const q of pids) { try { process.kill(q, 'SIGKILL'); } catch (e) { } }
    await sleep(1000);
    return { start: loaded ? loaded - t0 : null, mem, procs: pids.length };
}
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

(async () => {
    const apps = {
        tauri: () => once(path.join(__dirname, 'tauri/target/release/jeditor-spike'), [], {}),
        electron: () => {
            const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'el-'));
            return once(ELECTRON, ['--no-sandbox', '--require', path.join(__dirname, 'electron-timing.js'), path.join(ROOT, 'mac'), '--user-data', ud], {});
        },
    };
    for (const [name, run] of Object.entries(apps)) {
        const rs = [];
        for (let i = 0; i < RUNS; i++) rs.push(await run());
        console.log(name, JSON.stringify({
            firstStartMs: rs[0].start, startMs: median(rs.slice(1).map(r => r.start)),
            idlePssMB: Math.round(median(rs.map(r => r.mem))), procs: rs[0].procs, all: rs.map(r => r.start),
        }));
    }
})();
