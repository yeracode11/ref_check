const { describe, it } = require('node:test');
const assert = require('node:assert');
const { isMapMarkersRequest, buildMapLocationFilter } = require('../lib/mapFridgeQuery');

describe('mapFridgeQuery', () => {
  it('detects map=1', () => {
    assert.equal(isMapMarkersRequest({ map: '1' }), true);
    assert.equal(isMapMarkersRequest({}), false);
  });

  it('builds location filter', () => {
    const f = buildMapLocationFilter();
    assert.ok(f.location);
    assert.equal(f['location.coordinates.0'].$ne, 0);
  });
});
