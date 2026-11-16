// Loaded into the real Electron app (mac/main.js) with --require: prints
// "LOADED <unix ms>" when its page has loaded, like the Tauri spike.
const { app } = require('electron');
app.on('web-contents-created', (_e, wc) => wc.on('did-finish-load', () => console.log('LOADED ' + Date.now())));
