// The Photos library (photos.mm), or null where there's none to have (not
// a Mac, or the module isn't built): the sidebar then has no Photos library.
let photos = null;
try {
    if (process.platform === 'darwin') photos = require('./build/Release/photos.node');
} catch (e) {
    photos = null;
}
module.exports = photos;
