const { describe, it } = require('node:test');
const assert = require('node:assert');

describe('checkinStatsCache', () => {
  it('exports aggregation helpers', () => {
    const mod = require('../lib/checkinStatsCache');
    assert.equal(typeof mod.getCheckinStatsForFridges, 'function');
    assert.equal(typeof mod.aggregateStatsByFridgeRef, 'function');
    assert.equal(typeof mod.aggregateLegacyStatsByFridgeId, 'function');
  });
});
