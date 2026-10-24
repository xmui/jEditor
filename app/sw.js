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
    './codec.js',
    './codec-worker.js',
    './tiff.js',
    './codecs/avif_enc.js',
    './codecs/avif_enc.wasm',
    './codecs/jxl_enc.js',
    './codecs/jxl_enc.wasm',
    './codecs/jxl_dec.js',
    './codecs/jxl_dec.wasm',
    './host.js',
    './wheel.js',
    './experiments.js',
    './start.js',
    './picked.js',
    './permissions.js',
    './folder-cache.js',
    './photo-find.js',
    './upright-model.js',
    './upright.js',
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
    './paint.js',
    './paint-editor.js',
    './dupes.js',
    './rename.js',
    './folders.js',
    './flags.js',
    './edits.js',
    './history.js',
    './watch.js',
    './recents.js',
    './import.js',
    './blank.js',
    './modes.js',
    './themes.js',
    './disc.js',
    './export.js',
    './convert.js',
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
