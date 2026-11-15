// Restore colour test kit: clean scenes are faded the way real prints and
// slides fade (test/restore-kit/fade.js), restored with Develop's Restore
// colour, and scored by ΔE2000 against the clean scene. The scores are kept
// in test/restore-kit/scores.json; this fails if any case gets worse.
//   node test/restore-kit.test.js           check against the scores
//   node test/restore-kit.test.js --update  write the new scores
const fs = require('fs');
const path = require('path');
const { scenes } = require('./restore-kit/scenes');
const { fade, PROFILES } = require('./restore-kit/fade');
const { meanDE } = require('./restore-kit/deltae');

const src = fs.readFileSync(path.join(__dirname, '..', 'app', 'develop.js'), 'utf8');
const Develop = new Function(src + ';return Develop;')();

const CASES = [
    ['family', 'slideRed'], ['family', 'printCyan'], ['family', 'yellowStain'],
    ['family', 'fadedPrint'], ['family', 'unevenCyan'],
    ['beach', 'slideRed'], ['grass', 'printCyan'], ['interior', 'yellowStain'],
    // Not faded: Restore colour shouldn't spoil a photo that's fine
    ['family', 'none'], ['grass', 'none']
];
const CASE_SLACK = 0.3;   // ΔE a single case may get worse by
const MEAN_SLACK = 0.1;   // ΔE the mean may get worse by

// The kind of fade Auto should say it found, for each
const KIND = { slideRed: 'slide', printCyan: 'cyan', yellowStain: 'yellow', fadedPrint: 'print', unevenCyan: 'cyan', none: 'keep' };

function restore(px) {
    const adj = Develop.restoreAuto(px, {});
    return { kind: adj.restore && adj.restore.type, px: Develop.applyCPU(px, Develop.tables(adj), new Uint8ClampedArray(px.length)) };
}

const rows = CASES.map(([scene, profile]) => {
    const clean = scenes[scene]();
    const faded = profile === 'none' ? clean : fade(clean, PROFILES[profile]);
    const out = restore(faded.px);
    return {
        id: scene + '/' + profile,
        faded: +meanDE(clean.px, faded.px).toFixed(3),
        restored: +meanDE(clean.px, out.px).toFixed(3),
        kind: out.kind, want: KIND[profile]
    };
});
const mean = +(rows.reduce((s, r) => s + r.restored, 0) / rows.length).toFixed(3);

// Rolls: every scene faded the same way, restored together (Photos'
// Restore colour of a roll: Develop.restoreRoll). The sunset has no black
// or grey, so on its own it can't be told from a fade; in a roll it can
const ROLL = ['family', 'beach', 'grass', 'interior', 'sunset'];
const rolls = ['printCyan', 'slideRed', 'yellowStain', 'fadedPrint', 'none'].map(profile => {
    const clean = ROLL.map(s => scenes[s]());
    const faded = clean.map(c => profile === 'none' ? c : fade(c, PROFILES[profile]));
    const roll = Develop.restoreRoll(faded.map(f => f.px));
    const de = faded.map((f, i) => {
        const adj = Develop.restoreAuto(f.px, {}, 100, 'auto', roll);
        return meanDE(clean[i].px, Develop.applyCPU(f.px, Develop.tables(adj), new Uint8ClampedArray(f.px.length)));
    });
    const alone = faded.map((f, i) => meanDE(clean[i].px, restore(f.px).px));
    const avg = (a) => +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3);
    return { id: 'roll/' + profile, alone: avg(alone), restored: avg(de), kind: roll.type, want: KIND[profile] };
});

console.log('restore kit (ΔE2000 against the clean scene; lower is better)');
console.log('  case                     faded  restored  found');
for (const r of rows) console.log('  ' + r.id.padEnd(24) + String(r.faded).padStart(6) + String(r.restored).padStart(10) + '  ' + r.kind + (r.kind === r.want ? '' : ' (should be ' + r.want + ')'));
console.log('  ' + 'mean'.padEnd(24) + ''.padStart(6) + String(mean).padStart(10));
console.log('  roll (' + ROLL.join(', ') + ')    one by one  as a roll  found');
for (const r of rolls) console.log('  ' + r.id.padEnd(24) + String(r.alone).padStart(6) + String(r.restored).padStart(10) + '  ' + r.kind + (r.kind === r.want ? '' : ' (should be ' + r.want + ')'));

// An edit made with the first Restore colour (levels per channel) keeps it
{
    const v1 = { amount: 100, r: [0.2, 1.2, 0.9], g: [0.05, 0.9, 0.7], b: [0.1, 1, 0.8] };
    const kept = Develop.cleanRestore(v1);
    const T = Develop.channelTables(Develop.full({ restore: v1 }));
    const want = Develop.levels([0.2, 1.2, 0.9, 0, 1], 128 / 255);
    if (!kept || kept.d || Math.abs(T[128 * 4] - want) > 0.002) {
        console.log('  FAIL: an edit made with the first Restore colour is drawn differently', JSON.stringify(kept), T[128 * 4], want);
        process.exit(1);
    }
}

const file = path.join(__dirname, 'restore-kit', 'scores.json');
if (process.argv.includes('--update')) {
    const out = { mean, cases: Object.fromEntries(rows.concat(rolls).map(r => [r.id, r.restored])) };
    fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
    console.log('  scores written to test/restore-kit/scores.json');
    process.exit(0);
}

const base = JSON.parse(fs.readFileSync(file, 'utf8'));
const fails = rows.concat(rolls).filter(r => r.kind !== r.want).map(r => r.id + ': Auto found ' + r.kind + ', not ' + r.want);
for (const r of rows.concat(rolls)) {
    const was = base.cases[r.id];
    if (was === undefined) fails.push(r.id + ': no score kept (run with --update)');
    else if (r.restored > was + CASE_SLACK) fails.push(r.id + ': ' + was + ' → ' + r.restored);
}
if (mean > base.mean + MEAN_SLACK) fails.push('mean: ' + base.mean + ' → ' + mean);
if (fails.length) {
    console.log('  FAIL: Restore colour got worse');
    for (const f of fails) console.log('    ' + f);
    process.exit(1);
}
console.log('  ok' + (mean < base.mean - 0.05 ? ' (better than kept: ' + base.mean + ' → ' + mean + '; run with --update)' : ''));
