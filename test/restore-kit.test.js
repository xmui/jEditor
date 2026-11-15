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
    ['beach', 'slideRed'], ['grass', 'printCyan'], ['interior', 'yellowStain']
];
const CASE_SLACK = 0.3;   // ΔE a single case may get worse by
const MEAN_SLACK = 0.1;   // ΔE the mean may get worse by

function restore(px) {
    const adj = Develop.restoreAuto(px, {});
    return Develop.applyCPU(px, Develop.tables(adj), new Uint8ClampedArray(px.length));
}

const rows = CASES.map(([scene, profile]) => {
    const clean = scenes[scene]();
    const faded = fade(clean, PROFILES[profile]);
    return {
        id: scene + '/' + profile,
        faded: +meanDE(clean.px, faded.px).toFixed(3),
        restored: +meanDE(clean.px, restore(faded.px)).toFixed(3)
    };
});
const mean = +(rows.reduce((s, r) => s + r.restored, 0) / rows.length).toFixed(3);

console.log('restore kit (ΔE2000 against the clean scene; lower is better)');
console.log('  case                     faded  restored');
for (const r of rows) console.log('  ' + r.id.padEnd(24) + String(r.faded).padStart(6) + String(r.restored).padStart(10));
console.log('  ' + 'mean'.padEnd(24) + ''.padStart(6) + String(mean).padStart(10));

const file = path.join(__dirname, 'restore-kit', 'scores.json');
if (process.argv.includes('--update')) {
    const out = { mean, cases: Object.fromEntries(rows.map(r => [r.id, r.restored])) };
    fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n');
    console.log('  scores written to test/restore-kit/scores.json');
    process.exit(0);
}

const base = JSON.parse(fs.readFileSync(file, 'utf8'));
const fails = [];
for (const r of rows) {
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
