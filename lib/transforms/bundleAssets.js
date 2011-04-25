var seq = require('seq'),
    _ = require('underscore'),
    error = require('../error'),
    assets = require('../assets'),
    relations = require('../relations'),
    bundleStrategyByName = {};

// Internal helper function. Reuses the parse trees of existing assets, so be careful!
function makeBundle(assetGraph, queryObj, assetsToBundle, cb) {
    if (assetsToBundle.length < 2) {
        return process.nextTick(cb);
    }
    seq.ap(assetsToBundle)
        .parMap(function (asset) {
            asset.getParseTree(this);
        })
        .seq(function () {
            var bundleAsset = new assets[queryObj.type]({
                parseTree: assets[queryObj.type].mergeParseTrees(this.stack)
            });
            bundleAsset.url = assetGraph.resolver.root + bundleAsset.id + '.' + bundleAsset.defaultExtension; // FIXME
            assetGraph.addAsset(bundleAsset);

            var outgoingRelations = assetGraph.findRelations({from: assetsToBundle});
            outgoingRelations.forEach(function (outgoingRelation) {
                assetGraph.removeRelation(outgoingRelation);
            });

            var incomingRelations = assetGraph.findRelations({type: queryObj.incoming.type, to: assetsToBundle}),
                seenReferringAssets = {};
            if (incomingRelations.length > 0) {
                incomingRelations.forEach(function (incomingRelation) {
                    if (!(incomingRelation.from.id in seenReferringAssets)) {
                        assetGraph.attachAndAddRelation(new relations[queryObj.incoming.type]({
                            from: incomingRelation.from,
                            to: bundleAsset
                        }), 'before', incomingRelation);
                        seenReferringAssets[incomingRelation.from.id] = true;
                    }
                    assetGraph.detachAndRemoveRelation(incomingRelation);
                });
            }

            outgoingRelations.forEach(function (outgoingRelation) {
                outgoingRelation.from = bundleAsset;
                assetGraph.addRelation(outgoingRelation);
            });

            assetsToBundle.forEach(function (asset) {
                if (assetGraph.findRelations({to: asset}).length === 0) {
                    assetGraph.removeAsset(asset);
                }
            });
            this();
        })
        .seqErr(cb);
}

// Quick and dirty bundling strategy that gets you down to one <script> and one <link rel='stylesheet'>
// per document, but doesn't do any cross-page optimization.
bundleStrategyByName.createOneBundlePerIncludingAsset = function (assetGraph, queryObj, cb) {
    var seenIncludingAssets = {};

    assetGraph.findAssets(queryObj).forEach(function (asset) {
        assetGraph.findRelations({type: queryObj.incoming.type, to: asset}).forEach(function (incomingRelation) {
            seenIncludingAssets[incomingRelation.from.id] = incomingRelation.from;
        });
    });

    seq.ap(_.values(seenIncludingAssets))
        .seqEach(function (includingAsset) {
            var callback = this;
            seq.ap(assetGraph.findRelations({from: includingAsset, type: queryObj.incoming.type, to: {type: queryObj.type}}))
                .parMap(function (outgoingRelation) {
                    if (assetGraph.findRelations({to: outgoingRelation.to}).length > 1) {
                        assetGraph.cloneAsset(outgoingRelation.to, [outgoingRelation], this);
                    } else {
                        this(null, outgoingRelation.to);
                    }
                })
                .seq(function () {
                    makeBundle(assetGraph, queryObj, this.stack, this);
                })
                .seqErr(callback);
        })
        .seqErr(cb);
}

// Cross-page optimizing bundling strategy that never puts the same chunk in multiple bundles, but still tries
// to create as few bundles as possible. Also preserves inclusion order.
// FIXME: This bundling strategy is still quite buggy, please don't use it yet.
bundleStrategyByName.createSharedBundles = function (assetGraph, queryObj, cb) {
    var allAssets = assetGraph.findAssets(queryObj),
        assetIndex = {},
        seenIncludingAssets = {},
        bundles = [];

    allAssets.forEach(function (asset) {
        assetIndex[asset.id] = null; // Means not in a bundle yet
        assetGraph.findRelations({type: queryObj.incoming.type, to: asset}).forEach(function (incomingRelation) {
            seenIncludingAssets[incomingRelation.from.id] = incomingRelation.from;
        });
    });

    function splitBundle(bundle, index) {
        var newBundle = bundle.splice(index);
        newBundle.forEach(function (asset) {
            assetIndex[asset.id] = newBundle;
        });
        bundles.push(newBundle);
        return newBundle;
    }

    _.values(seenIncludingAssets).forEach(function (includingAsset) {
        var outgoingRelations = assetGraph.findRelations({from: includingAsset, type: queryObj.incoming.type}),
            previousBundle,
            canAppendToPreviousBundle = false,
            previousBundleIndex;

        outgoingRelations.forEach(function (outgoingRelation) {
            var existingBundle = assetIndex[outgoingRelation.to.id];
            if (existingBundle === null) {
                // Not bundled yet, append to previousBundle if possible, else create a new one
                if (canAppendToPreviousBundle) {
                    previousBundle.push(outgoingRelation.to);
                    previousBundleIndex = previousBundle.length - 1;
                } else {
                    if (previousBundle && previousBundleIndex !== previousBundle.length - 1) {
                        splitBundle(previousBundle, previousBundleIndex);
                    }
                    previousBundle = [outgoingRelation.to];
                    previousBundleIndex = 0;
                    bundles.push(previousBundle);
                    canAppendToPreviousBundle = true;
                }
                assetIndex[outgoingRelation.to.id] = previousBundle;
            } else if (existingBundle) {
                // Already in another bundle
                canAppendToPreviousBundle = false;
                var indexInExistingBundle = existingBundle.indexOf(outgoingRelation.to);
                if (previousBundle && existingBundle === previousBundle) {
                    if (indexInExistingBundle === previousBundleIndex + 1) {
                        previousBundleIndex = indexInExistingBundle;
                    } else {
                        splitBundle(previousBundle, indexInExistingBundle + 1);
                        existingBundle = assetIndex[outgoingRelation.to.id];
                        indexInExistingBundle = existingBundle.indexOf(outgoingRelation.to);
                        if (indexInExistingBundle !== 0) {
                            existingBundle = splitBundle(existingBundle, indexInExistingBundle);
                        }
                        previousBundle = existingBundle;
                        previousBundleIndex = 0;
                    }
                } else {
                    if (previousBundle && previousBundleIndex !== (previousBundle.length - 1)) {
                        splitBundle(previousBundle, previousBundleIndex + 1);
                    }
                    if (indexInExistingBundle !== 0) {
                        existingBundle = splitBundle(existingBundle, indexInExistingBundle);
                    }
                    previousBundle = existingBundle;
                    previousBundleIndex = 0;
                }
            } else {
                // The relation doesn't point at an asset matched by queryObj
                previousBundle = null;
                canAppendToPreviousBundle = false;
            }
        });
        // No more outgoing relations for this asset, make sure that the asset that was bundled
        // last is at the last position in its bundle:
        if (previousBundle && previousBundleIndex !== previousBundle.length - 1) {
            splitBundle(previousBundle, previousBundleIndex + 1);
        }
    });

    seq.ap(bundles)
        .parEach(function (bundle) {
            makeBundle(assetGraph, queryObj, bundle, this);
        })
        .seqErr(cb);
}

module.exports = function (queryObj, bundleStrategyName) {
    if (!('type' in queryObj) || !/^(?:CSS|JavaScript)$/.test(queryObj.type)) {
        throw new Error("transforms.bundleAssets: queryObj must have a 'type' property of 'JavaScript' or 'CSS'");
    }
    if (!queryObj.incoming || !queryObj.incoming.type) {
        throw new Error("transforms.bundleAssets: queryObj must have an 'incoming' obj with a 'type' property");
    }
    if (!bundleStrategyName) {
        bundleStrategyName = 'createOneBundlePerIncludingAsset';
    } else if (!(bundleStrategyName in bundleStrategyByName)) {
        throw new Error("transforms.bundleAssets: Unknown bundle strategy: " + bundleStrategyName);
    }

    return function bundleAssets(err, assetGraph, cb) {
        if (err) {
            throw err;
        }

        bundleStrategyByName[bundleStrategyName](assetGraph, queryObj, error.passToFunction(cb, function () {
            assetGraph.recomputeBaseAssets();
            cb();
        }));
    };
};
