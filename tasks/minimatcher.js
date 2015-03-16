var minimatch = require('minimatch');
module.exports = function (data, patterns, opts) {
    var i = 0,
        l = patterns? patterns.length: 0;

    for (; i < l; i++) {
        if (minimatch(data, patterns[i], opts)) {
            return true;
        }
    }

    return false;
};
