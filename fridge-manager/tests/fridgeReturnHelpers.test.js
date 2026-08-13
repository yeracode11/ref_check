const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveCityMapCenter, cityCenterToGeoPoint } = require('../lib/cityMapCenters');
const { applyReturnToHomeCity } = require('../lib/fridgeReturnHelpers');

describe('fridgeReturnHelpers', () => {
  it('resolveCityMapCenter finds Almaty by name and code', () => {
    const byName = resolveCityMapCenter('Алматы');
    const byCode = resolveCityMapCenter(undefined, '02');
    assert.ok(byName);
    assert.equal(byName.lat, 43.238949);
    assert.deepEqual(byCode, byName);
  });

  it('applyReturnToHomeCity moves returned fridge to city center and clears client', () => {
    const fridge = {
      warehouseStatus: 'returned',
      location: { type: 'Point', coordinates: [69.59, 42.34] },
      clientInfo: { name: 'Test IP' },
    };
    const result = applyReturnToHomeCity(fridge, { name: 'Алматы', code: '02' });
    assert.equal(result.applied, true);
    assert.equal(fridge.clientInfo, null);
    assert.equal(fridge.locationAtDepot, true);
    assert.deepEqual(fridge.location, cityCenterToGeoPoint(resolveCityMapCenter('Алматы')));
  });

  it('applyReturnToHomeCity moves warehouse fridge to city center', () => {
    const fridge = {
      warehouseStatus: 'warehouse',
      location: { type: 'Point', coordinates: [69.59, 42.34] },
      clientInfo: { name: 'Test IP' },
    };
    const result = applyReturnToHomeCity(fridge, { name: 'Алматы', code: '02' });
    assert.equal(result.applied, true);
    assert.equal(fridge.clientInfo?.name, 'Test IP');
    assert.equal(fridge.locationAtDepot, true);
    assert.deepEqual(fridge.location, cityCenterToGeoPoint(resolveCityMapCenter('Алматы')));
  });

  it('applyReturnToHomeCity skips installed fridges', () => {
    const fridge = {
      warehouseStatus: 'installed',
      location: { type: 'Point', coordinates: [69.59, 42.34] },
    };
    const result = applyReturnToHomeCity(fridge, { name: 'Алматы', code: '02' });
    assert.equal(result.applied, false);
    assert.deepEqual(fridge.location.coordinates, [69.59, 42.34]);
  });
});
