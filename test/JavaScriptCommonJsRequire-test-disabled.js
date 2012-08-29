var vows = require('vows'),
    assert = require('assert'),
    AssetGraph = require('../lib/AssetGraph');

vows.describe('relations.JavaScriptCommonJsRequire').addBatch({
    'After loading test case': {
        topic: function () {
            new AssetGraph({root: __dirname + '/JavaScriptCommonJsRequire/'})
                .loadAssets('index.js')
                .populate()
                .run(this.callback);
        },
        'the graph should contain 2 JavaScriptCommonJsRequire relations': function (assetGraph) {
            assert.equal(assetGraph.findRelations({type: 'JavaScriptCommonJsRequire'}).length, 2);
        },
        'the graph should contain 3 JavaScript assets': function (assetGraph) {
            assert.equal(assetGraph.findAssets({type: 'JavaScript'}).length, 3);
        }
    }
})['export'](module);