importScripts('./version.js');

const CACHE_NAME = 'jeditor-v' + APP_VERSION;
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './script.js',
    './version.js',
    './cropper.min.js',
    './cropper.min.css',
    './icon.png',
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
