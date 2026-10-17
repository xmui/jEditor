importScripts('./version.js');

const CACHE_NAME = 'jeditor-v' + APP_VERSION;
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './ui.js',
    './fit.js',
    './tokens.css',
    './version.js',
    './changelog.js',
    './meta.js',
    './host.js',
    './experiments.js',
    './start.js',
    './picked.js',
    './permissions.js',
    './folder-cache.js',
    './photo-find.js',
    './crop-auto.js',
    './crop.js',
    './crop-log.js',
    './raw.js',
    './retouch.js',
    './select.js',
    './develop.js',
    './adjust.js',
    './adjust-masks.js',
    './adjust-spots.js',
    './dupes.js',
    './rename.js',
    './folders.js',
    './flags.js',
    './edits.js',
    './history.js',
    './watch.js',
    './recents.js',
    './icon.png',
    './icon-192.png',
    './icon-maskable-512.png',
    './manifest.json'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) return caches.delete(key);
                })
            );
        })
    );
});

self.addEventListener('fetch', (e) => {
    e.respondWith(
        fetch(e.request).catch(() => caches.match(e.request))
    );
});
