// jEditor for Mac: the Photos library, read-only (step 1: browse it). The
// sidebar's "Photos library" row under Locations opens out to Favourites,
// Recently added and the albums; one opens as the project, read-only.
//
// It's the native module (native/photos.mm, PhotoKit), or for the tests a
// stand-in, JEDITOR_PHOTOS_LIBRARY=<folder>: each folder in it is an album
// (one called Favourites is the favourites), its photos are the library.
// Either way it's the same calls (see photos.mm), and main.js serves the
// pictures at app://jeditor/__photos/thumb/<id>?w=<px> and /__photos/full/<id>.

const fs = require('fs');
const path = require('path');

const PHOTO = /\.(jpe?g|png|gif|webp|heic|heif|tiff?)$/i;
const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

function standIn(root) {
    const photosIn = (dir) => {
        let names = [];
        try { names = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isFile() && PHOTO.test(d.name)).map(d => d.name); } catch (e) { /* none */ }
        return names.sort();
    };
    const albums = () => {
        try {
            return fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name)
                .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
        } catch (e) { return []; }
    };
    const fileOf = (id) => {
        const file = path.resolve(root, id);
        if (!file.startsWith(path.resolve(root) + path.sep)) throw new Error('That photo isn\'t in the library');
        if (!fs.existsSync(file)) throw new Error('That photo isn\'t in the library any more');
        return file;
    };
    const asset = (id) => {
        const file = fileOf(id);
        const st = fs.statSync(file);
        let w = 0, h = 0;
        try { ({ width: w, height: h } = require('electron').nativeImage.createFromPath(file).getSize()); } catch (e) { /* unknown */ }
        return { id, originalFilename: path.basename(file), created: st.mtimeMs, fileSize: st.size, w, h };
    };
    return {
        authStatus: () => process.env.JEDITOR_PHOTOS_AUTH || 'granted',
        requestAuth: async () => process.env.JEDITOR_PHOTOS_AUTH || 'granted',
        async collections() {
            const kind = (n) => (/^favou?rites$/i.test(n) ? 'favourites' : /^recently added$/i.test(n) ? 'recent' : 'album');
            const all = albums().map(n => ({ id: 'album:' + n, kind: kind(n), name: n, count: photosIn(path.join(root, n)).length }));
            const order = { favourites: 0, recent: 1, album: 2 };
            return all.sort((a, b) => order[a.kind] - order[b.kind]);
        },
        async assets(id) {
            if (!id) {
                const ids = [...photosIn(root), ...albums().flatMap(a => photosIn(path.join(root, a)).map(n => `${a}/${n}`))];
                return ids.map(asset).sort((a, b) => a.created - b.created);
            }
            const album = String(id).replace(/^album:/, '');
            if (!albums().includes(album)) throw new Error('That album isn\'t there any more');
            return photosIn(path.join(root, album)).map(n => asset(`${album}/${n}`));
        },
        async thumbnail(id, px) {
            const img = require('electron').nativeImage.createFromPath(fileOf(id));
            if (img.isEmpty()) throw new Error('No thumbnail for that photo');
            const { width, height } = img.getSize();
            const s = Math.min(1, px / Math.max(width, height));
            return img.resize({ width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)), quality: 'good' }).toJPEG(80);
        },
        async image(id) {
            const file = fileOf(id);
            const ext = path.extname(file).slice(1).toLowerCase();
            const data = await fs.promises.readFile(file);
            if (TYPES[ext]) return { data, type: TYPES[ext] };
            return { data: require('electron').nativeImage.createFromBuffer(data).toJPEG(92), type: 'image/jpeg' };
        }
    };
}

// The library: the stand-in when the tests ask for it, else the native
// module on a Mac, else none
const library = process.env.JEDITOR_PHOTOS_LIBRARY ? standIn(process.env.JEDITOR_PHOTOS_LIBRARY)
    : process.platform === 'darwin' ? require('./native/photos') : null;

// The built app may ask: macOS needs NSPhotoLibraryUsageDescription in its
// Info.plist (build.js), or it ends the app. Electron's own (npm start) has none.
const mayAsk = (packaged) => !!process.env.JEDITOR_PHOTOS_LIBRARY || packaged;

// What the permissions window shows for it (app/permissions.js)
function permissionState() {
    if (!library) return null;
    const s = library.authStatus();
    return s === 'granted' || s === 'limited' ? 'granted' : s === 'ask' ? 'ask' : 'denied';
}

// app://jeditor/__photos/thumb/<id>?w=<px>, /__photos/full/<id> → a Response, or null (not one of these)
async function respond(url) {
    const m = /^\/__photos\/(thumb|full)\/(.+)$/.exec(url.pathname);
    if (!m || !library) return null;
    const id = decodeURIComponent(m[2]);
    try {
        if (m[1] === 'thumb') {
            const px = Math.max(16, Math.min(2048, parseInt(url.searchParams.get('w'), 10) || 320));
            return new Response(await library.thumbnail(id, px), { headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store' } });
        }
        const r = await library.image(id);
        return new Response(r.data, { headers: { 'content-type': r.type, 'cache-control': 'no-store' } });
    } catch (e) {
        return new Response(e.message || 'Not found', { status: 404 });
    }
}

module.exports = { library, mayAsk, permissionState, respond };
