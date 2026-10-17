#!/usr/bin/env node
// Runs the Mac app's smoke test: makes a folder of photos, then
//   jEditor --smoke-test <folder>
// which opens it, turns a photo, flags one, deletes one and undoes that,
// checking on disk (mac/bridge.js, mac/main.js). Exits as the app does.
//
//   node scripts/smoke-test-mac.js                    dist/mac-universal/jEditor.app
//   node scripts/smoke-test-mac.js <path>/jEditor.app

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const bundle = path.resolve(process.argv[2] || path.join(ROOT, 'dist', 'mac-universal', 'jEditor.app'));
const exe = path.join(bundle, 'Contents', 'MacOS', 'jEditor');
if (!fs.existsSync(exe)) { console.error('No ' + exe + '; run node mac/build.js first'); process.exit(1); }

// Three small JPEGs, like a scanner's: no orientation tag
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAAQABgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCjRRRXz59kFFFFAH//2Q==', 'base64');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'jeditor-smoke-'));
const photos = path.join(work, 'Smoke Order');
fs.mkdirSync(photos);
for (let i = 1; i <= 3; i++) fs.writeFileSync(path.join(photos, `scan_000${i}.jpg`), JPEG);

console.log('Smoke test: ' + exe + ' on ' + photos);
const r = spawnSync(exe, ['--smoke-test', photos, '--user-data', path.join(work, 'profile')], { stdio: 'inherit', timeout: 180000 });
fs.rmSync(work, { recursive: true, force: true });
if (r.error) { console.error(r.error.message); process.exit(1); }
process.exit(r.status === 0 ? 0 : 1);
