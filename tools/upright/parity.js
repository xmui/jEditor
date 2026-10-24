// Checks upright.js's forward pass matches PyTorch's on the same input.
const fs = require('fs');
const vm = require('vm');
const ctx = { atob: (s) => Buffer.from(s, 'base64').toString('binary'), Math, Float32Array, Uint16Array, Uint8Array, Array, Infinity, NaN, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.argv[2], 'utf8') + '\n' + fs.readFileSync(process.argv[3], 'utf8') + '\nthis.Upright = Upright;', ctx);
const U = ctx.Upright;
U.load();
const x = new Float32Array(JSON.parse(fs.readFileSync('parity-in.json', 'utf8')));
const t0 = Date.now();
const out = U.forward(x);
console.log(JSON.stringify(Array.from(out)), Date.now() - t0, 'ms');
