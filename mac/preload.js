// What the page's bridge (bridge.js) may ask of the app: requests over IPC,
// messages from the app, and where a dropped File is on disk. JSON-like
// data only; folder handles never cross here (bridge.js gets them itself).

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('jeditorMac', {
    request: (type, data) => ipcRenderer.invoke('jeditor', type, data || {}),
    onMessage: (listener) => { ipcRenderer.on('jeditor', (e, msg) => listener(msg)); },
    pathForFile: (file) => { try { return webUtils.getPathForFile(file) || null; } catch (e) { return null; } },
    // macOS 26's toolbar holds the top row (main.js)
    nativeToolbar: process.argv.includes('--jeditor-native-toolbar'),
    // 'mac' or 'linux', and whether this copy can update itself (main.js)
    platform: process.argv.includes('--jeditor-linux') ? 'linux' : 'mac',
    updates: !process.argv.includes('--jeditor-no-updates')
});
