/*global setImmediate:true*/
// node 0.8 compat
if (typeof setImmediate === 'undefined') {
    setImmediate = process.nextTick;
}

var _ = require('underscore'),
    urlTools = require('../util/urlTools');

module.exports = function (fileUrl) {
    fileUrl = urlTools.ensureTrailingSlash(fileUrl);
    return function fixedDirectory(assetConfig, fromUrl, cb) {
        var labelRelativePath = assetConfig.url.replace(/^[^:]*:/, '');
        setImmediate(function () {
            cb(null, {
                url: fileUrl + labelRelativePath
            });
        });
    };
};
