const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parseBBox,
  parseZoom,
  gridCellDegrees,
  MAP_CLUSTER_ZOOM_THRESHOLD,
} = require('../lib/mapFridgeViewport');

describe('mapFridgeViewport', () => {
  it('parseBBox validates corners', () => {
    assert.deepEqual(parseBBox({ west: '71', south: '42', east: '72', north: '43' }), {
      west: 71,
      south: 42,
      east: 72,
      north: 43,
    });
    assert.equal(parseBBox({ west: '1', south: '2', east: '1', north: '3' }), null);
  });

  it('parseZoom clamps', () => {
    assert.equal(parseZoom({ zoom: '99' }), 19);
    assert.equal(parseZoom({ zoom: 'abc' }), 12);
  });

  it('gridCellDegrees returns null at high zoom', () => {
    assert.equal(gridCellDegrees(MAP_CLUSTER_ZOOM_THRESHOLD), null);
    assert.ok(gridCellDegrees(10) > 0);
  });
});
