const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const {
  buildFridgeCandidateIndex,
  buildManagerCityMap,
  resolveFridgeForCheckinRecord,
} = require('../lib/backfillCheckinFridgeRef');

describe('backfillCheckinFridgeRef', () => {
  const cityA = new mongoose.Types.ObjectId();
  const cityB = new mongoose.Types.ObjectId();

  const fridgeA = {
    _id: new mongoose.Types.ObjectId(),
    cityId: cityA,
    code: 'F1',
    number: '1001',
    location: { type: 'Point', coordinates: [76.9, 43.2] },
  };
  const fridgeB = {
    _id: new mongoose.Types.ObjectId(),
    cityId: cityB,
    code: 'F2',
    number: '1001',
    location: { type: 'Point', coordinates: [71.4, 51.1] },
  };

  const index = buildFridgeCandidateIndex([fridgeA, fridgeB]);
  const managerCityMap = buildManagerCityMap([
    { _id: new mongoose.Types.ObjectId(), username: 'mgr_alma', cityId: cityA },
  ]);

  it('resolves duplicate number by manager city', () => {
    const checkin = {
      fridgeId: 1001,
      managerId: 'mgr_alma',
      location: { coordinates: [76.91, 43.21] },
    };
    const { fridge, reason } = resolveFridgeForCheckinRecord(checkin, index, managerCityMap);
    assert.equal(String(fridge._id), String(fridgeA._id));
    assert.equal(reason, 'manager_city');
  });

  it('resolves checkin with fridgeId = Fridge._id string', () => {
    const fridge = {
      _id: new mongoose.Types.ObjectId(),
      cityId: cityA,
      code: 'X9',
      number: '9999',
      location: { type: 'Point', coordinates: [76.9, 43.2] },
    };
    const idx = buildFridgeCandidateIndex([fridge]);
    const checkin = {
      fridgeId: String(fridge._id),
      managerId: 'mgr',
      location: { coordinates: [76.9, 43.2] },
    };
    const { fridge: resolved, reason } = resolveFridgeForCheckinRecord(
      checkin,
      idx,
      new Map(),
    );
    assert.equal(String(resolved._id), String(fridge._id));
    assert.equal(reason, 'unique_match');
  });
});
