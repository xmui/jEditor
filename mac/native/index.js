// The native toolbar, or null where there's none to have (not a Mac, or
// the module isn't built): the page then keeps its own top row of pills.
let toolbar = null;
try {
    if (process.platform === 'darwin') toolbar = require('./build/Release/toolbar.node');
} catch (e) {
    toolbar = null;
}
module.exports = toolbar;
