const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { haversineMeters, findRecentDuplicateCheckin } = require('../utils/checkinGeodesic');

describe('haversineMeters', () => {
  it('returns ~0 for identical points', () => {
    assert.ok(haversineMeters(71.4, 42.9, 71.4, 42.9) < 1);
  });

  it('returns plausible distance for separated points', () => {
    const m = haversineMeters(71.4, 42.9, 71.41, 42.91);
    assert.ok(m > 800 && m < 2000);
  });
});

describe('findRecentDuplicateCheckin', () => {
  const now = Date.now();
  const base = {
    managerId: '17',
    fridgeId: '12345',
    visitedAt: new Date(now - 10_000),
    location: { coordinates: [71.4, 42.9] },
  };

  const params = (overrides = {}) => ({
    managerIds: ['17'],
    fridgeIdCandidates: ['12345'],
    lng: 71.40001,
    lat: 42.90001,
    now,
    windowMs: 120_000,
    maxDistanceM: 40,
    ...overrides,
  });

  it('finds duplicate for same manager, fridge, time window and close coords', () => {
    const dup = findRecentDuplicateCheckin([base], params());
    assert.equal(dup, base);
  });

  it('finds duplicate when fridgeId stored as number', () => {
    const numeric = { ...base, fridgeId: 12345 };
    const dup = findRecentDuplicateCheckin([numeric], params({ fridgeIdCandidates: ['12345', '#12345'] }));
    assert.equal(dup, numeric);
  });

  it('finds duplicate when managerId is ObjectId string vs username', () => {
    const objectId = '507f1f77bcf86cd799439011';
    const withObjectId = { ...base, managerId: objectId };
    const dup = findRecentDuplicateCheckin(
      [withObjectId],
      params({ managerIds: ['17', objectId] }),
    );
    assert.equal(dup, withObjectId);
  });

  it('returns null if manager differs', () => {
    const dup = findRecentDuplicateCheckin([base], params({ managerIds: ['99'] }));
    assert.equal(dup, null);
  });

  it('returns null if outside time window', () => {
    const old = { ...base, visitedAt: new Date(now - 200_000) };
    const dup = findRecentDuplicateCheckin([old], params({ lng: 71.4, lat: 42.9 }));
    assert.equal(dup, null);
  });

  it('returns null if coordinates too far', () => {
    const dup = findRecentDuplicateCheckin([base], params({ lng: 72.5, lat: 43.5 }));
    assert.equal(dup, null);
  });

  it('repeat same mark is not treated as conflict — duplicate is returned (idempotent path)', () => {
    const dup = findRecentDuplicateCheckin([base], params({ lng: 71.4, lat: 42.9 }));
    assert.ok(dup);
    assert.equal(dup.managerId, '17');
  });
});
