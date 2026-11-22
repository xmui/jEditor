// The app's words name no other app or brand (the owner, for 2.0): every
// explanation says what a thing does, not which app it's like. The only
// names kept are the keyboard shortcut profiles that match another app's
// keys (KEY_PROFILES in script.js), since that's what they are.
//
// Checks the text the app shows: the page (comments left out) and the
// strings in its scripts (comments left out). The guide and the changelog
// are left to their own pass. Runs without a browser.

const fs = require('fs');
const path = require('path');
const APP = path.join(__dirname, '..', 'app');

const BRANDS = /\b(Lightroom|Photoshop|Photomator|Pixelmator|Apple Photos|Capture One|Affinity Photo|Procreate|GIMP|Snapseed|Darktable|Google Photos|Windows Photos|iPhoto|FastFoto|Epson|Plustek|Canva)\b/;
const SKIP = new Set(['changelog.js', 'guide.js']);

let passed = 0, failed = 0;
function check(name, ok, detail) {
    if (ok) { passed++; console.log(`  ok    ${name}`); }
    else { failed++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`); }
}

// The shortcut profiles' names: allowed
const script = fs.readFileSync(path.join(APP, 'script.js'), 'utf8');
const profiles = script.slice(script.indexOf('KEY_PROFILES: {'));
const allowed = new Set([...profiles.slice(0, profiles.indexOf('\n    },\n')).matchAll(/\bname: '([^']+)'/g)].map(m => m[1]));
// A file signature, not words anyone reads (meta.js: a JPEG's IPTC block)
allowed.add('Photoshop 3.0\\0');

// A script without its comments, then its string literals
function strings(src) {
    const out = [];
    let i = 0;
    while (i < src.length) {
        const c = src[i], n = src[i + 1];
        if (c === '/' && n === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
        if (c === '/' && n === '*') { i = src.indexOf('*/', i + 2) + 2; if (i < 2) break; continue; }
        if (c === '/' && /[(,=:[!&|?{};]\s*$/.test(src.slice(Math.max(0, i - 20), i))) {
            // a regular expression: skip it, with its classes
            let j = i + 1, cls = false;
            while (j < src.length && (cls || src[j] !== '/') && src[j] !== '\n') {
                if (src[j] === '\\') j++;
                else if (src[j] === '[') cls = true;
                else if (src[j] === ']') cls = false;
                j++;
            }
            i = j + 1;
            continue;
        }
        if (c === '\'' || c === '"' || c === '`') {
            let j = i + 1;
            while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++; }
            out.push(src.slice(i + 1, j));
            i = j + 1;
            continue;
        }
        i++;
    }
    return out;
}

const found = [];
for (const f of fs.readdirSync(APP).filter(f => /\.(js|html)$/.test(f) && !SKIP.has(f)).sort()) {
    const src = fs.readFileSync(path.join(APP, f), 'utf8');
    const texts = f.endsWith('.html') ? [src.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/g, '')] : strings(src);
    for (const t of texts) {
        if (allowed.has(t)) continue;
        for (const line of t.split('\n')) {
            const m = line.match(BRANDS);
            if (m) found.push(`${f}: ${m[0]} in "${line.trim().slice(0, 90)}"`);
        }
    }
}

console.log('words: no other app or brand named');
check('the shortcut profiles are found (the names allowed)', allowed.size > 2 && allowed.has('jEditor'), [...allowed].join(', '));
check('no other app or brand is named in the app\'s text (only the shortcut profiles)', found.length === 0, found.join('; '));
// The test itself catches one
check('a brand in a string is caught, and one in a comment isn\'t', strings('// as in Lightroom\nconst a = "like Lightroom";').some(s => BRANDS.test(s)) && !strings('// as in Lightroom\nconst a = 1;').some(s => BRANDS.test(s)));


// US English in everything shown (the owner: "color", not "colour"): the
// common UK spellings, in the scripts' strings (the guide and the
// changelog too), the page's text and its words in titles and labels, and
// the user guide (docs/using-jeditor.md, outside code). Keys, ids,
// classes and saved settings keep their old names ('colour', 'ex-colour'),
// so a string that's one lowercase word or a name with - . # in it is left
// out, as is a search's list of words that has the US one too
const UK = /\b(colou?rs?|colou?red|colou?ring|colou?rful|discolou?r\w*|gr[ea]ys?|gr[ea]yed|gr[ea]yish|gr[ea]yscale|centres?|centred|centring|favourites?|behaviours?|licences?|cancelled|cancelling|labelled|labelling|levelled|levelling|travelled|modelled|modelling|neighbours?|neighbouring|honour|flavour|humour|(?:centi|milli)?metres?|fibre|theatre|catalogue|dialogues?|analogue|whilst|amongst|focussed|artefacts?|programmes?|defence|judgement|ageing|analys(?:e|ed|ing)|(?:organ|recogn|custom|optim|normal|minim|maxim|summar|visual|priorit|synchron|real|util|special|local|equal|neutral|character|capital|digit|sensit|harmon|stabil|serial|memor|final|categor|author|personal|standard|apolog|initial|colour|random|general|global|mobil|popular|regular)is(?:e|es|ed|ing|ation|ations|er|ers|able))\b/gi;
const US_OF = (w) => w.toLowerCase().replace(/our/, 'or').replace(/^grey/, 'gray').replace(/tre(s?)$/, 'ter$1').replace(/tred$/, 'tered').replace(/is(e|es|ed|ing|ation|ations|er|ers|able)$/, 'iz$1');
const ukIn = (text) => {
    const out = [];
    for (const m of text.matchAll(UK)) {
        const w = m[0], i = m.index;
        if (/^(colors?|colored|coloring|colorful|discolor\w*|grays?|grayed|grayish|grayscale)$/i.test(w)) continue;
        const before = text[i - 1] || '', after = text[i + w.length] || '';
        if (/[\w$\-.#\/@]/.test(before) || /[\w$\-\/@(]/.test(after) || (after === '.' && /\w/.test(text[i + w.length + 1] || ''))) continue;
        out.push(w);
    }
    return out;
};
const prose = (s) => !(s.startsWith('#version') || (/^[a-z0-9_.\-:#\/\[\]=" ]*$/.test(s) && !/ /.test(s)) || (/[.#\[]/.test(s) && /^(\[|\.|#)?[a-z][\w-]*([.\s#>,:\[\]=]+[\w-]+)*\]?$/.test(s)));
// (side by side: a search's list of words, 'colour color')
const withBoth = (s, words) => words.some(w => new RegExp('\\b(' + w + '\\s+' + US_OF(w) + '|' + US_OF(w) + '\\s+' + w + ')\\b', 'i').test(s));
const uk = [];
for (const f of fs.readdirSync(APP).filter(f => /\.(js|html)$/.test(f)).sort()) {
    const src = fs.readFileSync(path.join(APP, f), 'utf8');
    let texts;
    if (f.endsWith('.html')) {
        const page = src.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[\s\S]*?<\/\1>/g, '');
        texts = [page.replace(/<[^>]*>/g, ' '), ...[...page.matchAll(/\s(?:title|aria-label|placeholder|alt|data-tip|label)="([^"]*)"/g)].map(m => m[1])];
    } else texts = strings(src).filter(prose);
    for (const t of texts) {
        const words = ukIn(t);
        if (words.length && !withBoth(t, words)) uk.push(`${f}: ${words.join(', ')} in "${t.trim().slice(0, 80)}"`);
    }
}
const guideMd = fs.readFileSync(path.join(__dirname, '..', 'docs', 'using-jeditor.md'), 'utf8')
    .replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '').replace(/\]\([^)]*\)/g, ']').replace(/https?:\/\/\S+/g, '');
for (const line of guideMd.split('\n')) {
    const words = ukIn(line).filter(w => !/^mid$/i.test(w));
    if (words.length) uk.push(`docs/using-jeditor.md: ${words.join(', ')} in "${line.trim().slice(0, 80)}"`);
}
console.log('words: US English');
check('US spelling in the app\'s text, the guide and the changelog (color, gray, center, favorite, canceled, -ize)', uk.length === 0, uk.slice(0, 20).join('; ') + (uk.length > 20 ? ` … and ${uk.length - 20} more` : ''));
check('... a UK spelling in shown text is caught; keys, names and comments aren\'t', ukIn('The colour of the centre, greyed out, minimised').length === 4
    && strings('// a colour\nconst k = \'colour\', c = \'ex-colour\', t = \'Pick a colour\';').filter(prose).flatMap(ukIn).join() === 'colour');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
