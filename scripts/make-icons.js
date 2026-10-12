#!/usr/bin/env node
// Regenerates PWA icons from app/icon.png:
//   icon-192.png            downscaled launcher icon
//   icon-maskable-512.png   icon at 80% on the app background (safe zone
//                           for round/squircle masks)
// Run after changing icon.png:  node scripts/make-icons.js

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const APP = path.join(__dirname, '..', 'app');

function launchOptions() {
    const candidates = [
        process.env.CHROME_PATH,
        '/opt/pw-browsers/chromium',
        '/usr/bin/chromium',
        '/usr/bin/google-chrome'
    ].filter(Boolean);
    for (const p of candidates) if (fs.existsSync(p)) return { executablePath: p, args: ['--no-sandbox'] };
    return { channel: 'chrome', args: ['--no-sandbox'] };
}

(async () => {
    const iconB64 = fs.readFileSync(path.join(APP, 'icon.png')).toString('base64');
    const browser = await chromium.launch(launchOptions());
    const page = await browser.newPage();

    const results = await page.evaluate(async (b64) => {
        const img = new Image();
        await new Promise((res, rej) => {
            img.onload = res;
            img.onerror = rej;
            img.src = 'data:image/png;base64,' + b64;
        });

        const render = (size, pad, bg) => {
            const c = document.createElement('canvas');
            c.width = size;
            c.height = size;
            const ctx = c.getContext('2d');
            if (bg) {
                ctx.fillStyle = bg;
                ctx.fillRect(0, 0, size, size);
            }
            const inner = size - pad * 2;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, pad, pad, inner, inner);
            return c.toDataURL('image/png').split(',')[1];
        };

        return {
            'icon-192.png': render(192, 0, null),
            'icon-maskable-512.png': render(512, 51, '#0c0c0c') // 10% safe zone
        };
    }, iconB64);

    for (const [name, b64] of Object.entries(results)) {
        fs.writeFileSync(path.join(APP, name), Buffer.from(b64, 'base64'));
        console.log(`wrote app/${name}`);
    }
    await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
