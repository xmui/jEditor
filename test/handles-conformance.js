// The file operations jEditor's page does, run on a folder handle, with
// what each gives (a value, or an error's name). Run in the page on
// Chromium's own handles and on the host's (mac/handles.js), the two must
// give the same: test/handles.test.js and test/mac.test.js.
//
// CONFORMANCE is page code (a string, for page.evaluate):
//   (await (eval(CONFORMANCE)))(rootHandle) → { check: result, … }

const CONFORMANCE = `(async (root) => {
    const out = {};
    const err = (e) => 'throws ' + (e && e.name);
    const t = async (k, f) => { try { out[k] = await f(); } catch (e) { out[k] = err(e); } };
    const text = async (h) => (await h.getFile()).text();
    const write = async (h, data, opts) => { const w = await h.createWritable(opts); await w.write(data); await w.close(); };
    const names = async (d) => { const n = []; for await (const k of d.keys()) n.push(k); return n.sort().join(','); };

    // Start clean (a folder kept from a run before)
    for await (const k of root.keys()) await root.removeEntry(k, { recursive: true });

    await t('kind and name', () => root.kind + ':' + (typeof root.name));
    await t('permission', async () => typeof root.queryPermission === 'function' ? root.queryPermission({ mode: 'readwrite' }) : 'none');
    await t('requestPermission', async () => typeof root.requestPermission === 'function' ? root.requestPermission({ mode: 'readwrite' }) : 'none');

    // ---- Files ----
    await t('missing file', async () => (await root.getFileHandle('a.txt')).name);
    await t('create file', async () => { const h = await root.getFileHandle('a.txt', { create: true }); return h.kind + ':' + h.name + ':' + (await h.getFile()).size; });
    const a = await root.getFileHandle('a.txt');
    await t('write and read', async () => { await write(a, 'hello'); return text(a); });
    await t('file type and name', async () => { const f = await a.getFile(); return f.name + '|' + f.type + '|' + (f instanceof File) + '|' + (typeof f.lastModified === 'number' && f.lastModified > 0); });
    await t('jpg type', async () => { const h = await root.getFileHandle('p.jpg', { create: true }); return (await h.getFile()).type; });
    await t('types', async () => {
        const o = [];
        for (const ext of ['jpeg', 'JPG', 'png', 'gif', 'webp', 'avif', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'jxl', 'svg', 'json', 'csv', 'xml', 'pdf', 'zip', 'mp4', 'mov', 'dng', 'cr2', 'nef', 'arw', 'psd', 'xmp', 'bin', 'noext']) {
            const n = ext === 'noext' ? 'noext' : 'f.' + ext;
            const h = await root.getFileHandle(n, { create: true });
            o.push(ext + '=' + (await h.getFile()).type);
            await root.removeEntry(n);
        }
        return o.join(' ');
    });
    await t('not written until close', async () => {
        const w = await a.createWritable(); await w.write('XXXXXXXX');
        const before = await text(a); await w.close(); return before + '>' + await text(a);
    });
    await t('abort leaves it', async () => { const w = await a.createWritable(); await w.write('gone'); await w.abort(); return text(a); });
    await t('a new writable starts empty', async () => { const w = await a.createWritable(); await w.write('ab'); await w.close(); return text(a); });
    await t('keepExistingData, seek, write at', async () => {
        await write(a, 'abcdef');
        const w = await a.createWritable({ keepExistingData: true });
        await w.seek(2); await w.write('XY'); await w.write({ type: 'write', position: 5, data: 'Z' }); await w.close();
        return text(a);
    });
    await t('truncate', async () => {
        const w = await a.createWritable({ keepExistingData: true }); await w.truncate(3); await w.close();
        const w2 = await a.createWritable({ keepExistingData: true }); await w2.write({ type: 'truncate', size: 5 }); await w2.close();
        const f = await a.getFile(); return f.size + ':' + JSON.stringify(Array.from(new Uint8Array(await f.arrayBuffer())));
    });
    await t('write past the end fills with zeros', async () => {
        await write(a, 'ab'); const w = await a.createWritable({ keepExistingData: true });
        await w.write({ type: 'write', position: 4, data: 'c' }); await w.close();
        return JSON.stringify(Array.from(new Uint8Array(await (await a.getFile()).arrayBuffer())));
    });
    await t('write kinds', async () => {
        const w = await a.createWritable();
        await w.write('s'); await w.write(new Blob(['b'])); await w.write(new TextEncoder().encode('u'));
        await w.write(new TextEncoder().encode('xa').buffer); await w.write(new DataView(new TextEncoder().encode('d').buffer));
        await w.write({ type: 'write', data: 'w' });
        await w.close(); return text(a);
    });
    await t('a big file', async () => {
        const big = new Uint8Array(20 * 1024 * 1024 + 7); for (let i = 0; i < big.length; i += 4093) big[i] = i % 251;
        const h = await root.getFileHandle('big.bin', { create: true }); await write(h, big);
        const got = new Uint8Array(await (await h.getFile()).arrayBuffer());
        let same = got.length === big.length; for (let i = 0; same && i < big.length; i += 4093) same = got[i] === big[i];
        return got.length + ':' + same;
    });
    await t('slice of a file', async () => (await (await a.getFile()).slice(1, 3).text()));
    await t('a file read as it was', async () => {
        await write(a, 'one'); const f = await a.getFile(); await write(a, 'two!');
        try { return await f.text(); } catch (e) { return err(e); }
    });

    // ---- Names ----
    for (const bad of ['', '.', '..', 'a/b', 'a\\\\b']) await t('bad name ' + JSON.stringify(bad), async () => (await root.getFileHandle(bad, { create: true })).name);

    // ---- Folders ----
    await t('missing folder', async () => (await root.getDirectoryHandle('d')).name);
    await t('create folder', async () => { const d = await root.getDirectoryHandle('d', { create: true }); return d.kind + ':' + d.name; });
    const d = await root.getDirectoryHandle('d');
    await t('file asked for as a folder', async () => (await root.getDirectoryHandle('a.txt')).name);
    await t('folder asked for as a file', async () => (await root.getFileHandle('d')).name);
    await t('folder asked for as a file, create', async () => (await root.getFileHandle('d', { create: true })).name);
    await t('entries', async () => { const o = []; for await (const [n, h] of root.entries()) o.push(n + ':' + h.kind + ':' + (h.name === n)); return o.sort().join(','); });
    await t('values', async () => { const o = []; for await (const h of root.values()) o.push(h.name); return o.sort().join(','); });
    await t('for await of the folder', async () => { const o = []; for await (const [n] of root) o.push(n); return o.sort().join(','); });
    await t('nested', async () => { const e = await d.getDirectoryHandle('e', { create: true }); await write(await e.getFileHandle('x.txt', { create: true }), 'x'); return (await names(d)) + '/' + (await names(e)); });
    await t('resolve', async () => {
        const e = await d.getDirectoryHandle('e'); const x = await e.getFileHandle('x.txt');
        return JSON.stringify([await root.resolve(x), await root.resolve(root), await e.resolve(a), await d.resolve(e)]);
    });
    await t('isSameEntry', async () => {
        const again = await root.getFileHandle('a.txt'), b = await root.getFileHandle('p.jpg');
        return [await a.isSameEntry(again), await a.isSameEntry(b), await a.isSameEntry(root), await d.isSameEntry(await root.getDirectoryHandle('d'))].join(',');
    });

    // ---- Removing ----
    await t('remove a missing one', async () => { await root.removeEntry('nope.txt'); return 'removed'; });
    await t('remove a folder with things in it', async () => { await root.removeEntry('d'); return 'removed'; });
    await t('remove a file', async () => { const h = await root.getFileHandle('r.txt', { create: true }); await root.removeEntry('r.txt'); return (await names(root)); });
    await t('a removed file read', async () => { const h = await root.getFileHandle('r2.txt', { create: true }); await root.removeEntry('r2.txt'); return (await h.getFile()).size; });
    await t('remove a folder, recursive', async () => { const z = await root.getDirectoryHandle('z', { create: true }); await z.getFileHandle('q', { create: true }); await root.removeEntry('z', { recursive: true }); return (await names(root)); });

    // ---- Moving ----
    await t('move(newName)', async () => {
        const h = await root.getFileHandle('m1.txt', { create: true }); await write(h, 'm');
        await h.move('m2.txt'); return h.name + '|' + (await names(root)) + '|' + await text(h);
    });
    await t('move(newName) over a file there', async () => {
        const h = await root.getFileHandle('m3.txt', { create: true }); await write(h, 'new');
        const o = await root.getFileHandle('m4.txt', { create: true }); await write(o, 'old');
        await h.move('m4.txt'); return (await names(root)) + '|' + await text(await root.getFileHandle('m4.txt'));
    });
    await t('move(folder)', async () => {
        const h = await root.getFileHandle('m4.txt'); await h.move(d);
        return (await names(root)) + '|' + (await names(d)) + '|' + await text(h) + '|' + JSON.stringify(await root.resolve(h));
    });
    await t('move(folder, name)', async () => {
        const h = await d.getFileHandle('m4.txt'); await h.move(root, 'back.txt');
        return h.name + '|' + (await names(d)) + '|' + (await text(await root.getFileHandle('back.txt')));
    });
    await t('move a folder', async () => {
        const f = await root.getDirectoryHandle('f1', { create: true }); await f.getFileHandle('in.txt', { create: true });
        await f.move(d, 'f2'); return f.name + '|' + (await names(d)) + '|' + (await names(f));
    });
    await t('move a folder into itself', async () => { const f = await d.getDirectoryHandle('f2'); await f.move(f, 'x'); return 'moved'; });
    await t('move with a bad name', async () => { const h = await root.getFileHandle('back.txt'); await h.move('a/b'); return 'moved'; });
    await t('move a missing one', async () => { const h = await root.getFileHandle('gone.txt', { create: true }); await root.removeEntry('gone.txt'); await h.move('gone2.txt'); return 'moved'; });

    for await (const k of root.keys()) await root.removeEntry(k, { recursive: true });
    await t('empty at the end', () => names(root));
    return out;
})`;

// What Chromium's own handles give, on a folder on disk (Electron 44) and in
// OPFS alike. The host's handles must give the same, except where KNOWN says.
const EXPECTED = {
    "kind and name": "directory:string",
    "permission": "granted",
    "requestPermission": "granted",
    "missing file": "throws NotFoundError",
    "create file": "file:a.txt:0",
    "write and read": "hello",
    "file type and name": "a.txt|text/plain|true|true",
    "jpg type": "image/jpeg",
    "types": "jpeg=image/jpeg JPG=image/jpeg png=image/png gif=image/gif webp=image/webp avif=image/avif bmp=image/bmp tif=image/tiff tiff=image/tiff heic= heif= jxl=image/jxl svg=image/svg+xml json=application/json csv=text/csv xml=text/xml pdf=application/pdf zip=application/zip mp4=video/mp4 mov= dng= cr2= nef= arw= psd= xmp= bin=application/octet-stream noext=",
    "not written until close": "hello>XXXXXXXX",
    "abort leaves it": "XXXXXXXX",
    "a new writable starts empty": "ab",
    "keepExistingData, seek, write at": "abXYeZ",
    "truncate": "5:[97,98,88,0,0]",
    "write past the end fills with zeros": "[97,98,0,0,99]",
    "write kinds": "sbuxadw",
    "a big file": "20971527:true",
    "slice of a file": "bu",
    "a file read as it was": "throws NotReadableError",
    "bad name \"\"": "throws TypeError",
    "bad name \".\"": "throws TypeError",
    "bad name \"..\"": "throws TypeError",
    "bad name \"a/b\"": "throws TypeError",
    "bad name \"a\\\\b\"": "throws TypeError",
    "missing folder": "throws NotFoundError",
    "create folder": "directory:d",
    "file asked for as a folder": "throws TypeMismatchError",
    "folder asked for as a file": "throws TypeMismatchError",
    "folder asked for as a file, create": "throws TypeMismatchError",
    "entries": "a.txt:file:true,big.bin:file:true,d:directory:true,p.jpg:file:true",
    "values": "a.txt,big.bin,d,p.jpg",
    "for await of the folder": "a.txt,big.bin,d,p.jpg",
    "nested": "e/x.txt",
    "resolve": "[[\"d\",\"e\",\"x.txt\"],[],null,[\"e\"]]",
    "isSameEntry": "true,false,false,true",
    "remove a missing one": "throws NotFoundError",
    "remove a folder with things in it": "throws InvalidModificationError",
    "remove a file": "a.txt,big.bin,d,p.jpg",
    "a removed file read": "throws NotFoundError",
    "remove a folder, recursive": "a.txt,big.bin,d,p.jpg",
    "move(newName)": "m2.txt|a.txt,big.bin,d,m2.txt,p.jpg|m",
    "move(newName) over a file there": "a.txt,big.bin,d,m2.txt,m4.txt,p.jpg|new",
    "move(folder)": "a.txt,big.bin,d,m2.txt,p.jpg|e,m4.txt|new|[\"d\",\"m4.txt\"]",
    "move(folder, name)": "back.txt|e|new",
    "move a folder": "throws TypeError",
    "move a folder into itself": "throws NotFoundError",
    "move with a bad name": "throws TypeError",
    "move a missing one": "throws NotFoundError",
    "empty at the end": ""
};

// Where the host's handles differ, and why that's fine:
// - a File got before the file changed still reads what it had (Chromium's
//   reads the disk again and refuses, as the file changed under it)
const KNOWN = { 'a file read as it was': 'one' };

module.exports = { CONFORMANCE, EXPECTED, KNOWN };
