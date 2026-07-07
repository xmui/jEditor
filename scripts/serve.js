#!/usr/bin/env node
// Tiny static server for the app/ folder. No dependencies.
// Usage: node scripts/serve.js [port]   (default 3000; 0 = random free port)

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'app');
const MIME = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json'
};

function createServer() {
    return http.createServer((req, res) => {
        const urlPath = decodeURIComponent(req.url.split('?')[0]);
        let filePath = path.normalize(path.join(ROOT, urlPath));
        if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
        if (urlPath.endsWith('/')) filePath = path.join(filePath, 'index.html');
        fs.readFile(filePath, (err, data) => {
            if (err) { res.writeHead(404); res.end('Not found'); return; }
            res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
            res.end(data);
        });
    });
}

module.exports = { createServer };

if (require.main === module) {
    const port = process.argv[2] !== undefined ? Number(process.argv[2]) : 3000;
    const server = createServer();
    server.listen(port, () => {
        console.log(`jEditor running at http://localhost:${server.address().port}/`);
    });
}
