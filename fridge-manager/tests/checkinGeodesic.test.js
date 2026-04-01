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

  it('finds duplicate for same manager, fridge, time window and close coords', () => {
    const dup = findRecentDuplicateCheckin([base], {
      managerId: '17',
      fridgeId: '12345',
      lng: 71.40001,
      lat: 42.90001,
      now,
      windowMs: 120_000,
      maxDistanceM: 40,
    });
    assert.equal(dup, base);
  });

  it('returns null if manager differs', () => {
    const dup = findRecentDuplicateCheckin([base], {
      managerId: '99',
      fridgeId: '12345',
      lng: 71.4,
      lat: 42.9,
      now,
      windowMs: 120_000,
      maxDistanceM: 40,
    });
    assert.equal(dup, null);
  });

  it('returns null if outside time window', () => {
    const old = { ...base, visitedAt: new Date(now - 200_000) };
    const dup = findRecentDuplicateCheckin([old], {
      managerId: '17',
      fridgeId: '12345',
      lng: 71.4,
      lat: 42.9,
      now,
      windowMs: 120_000,
      maxDistanceM: 40,
    });
    assert.equal(dup, null);
  });

  it('returns null if coordinates too far', () => {
    const dup = findRecentDuplicateCheckin([base], {
      managerId: '17',
      fridgeId: '12345',
      lng: 72.5,
      lat: 43.5,
      now,
      windowMs: 120_000,
      maxDistanceM: 40,
    });
    assert.equal(dup, null);
  });

  it('repeat same mark is not treated as conflict — duplicate is returned (idempotent path)', () => {
    const dup = findRecentDuplicateCheckin([base], {
      managerId: '17',
      fridgeId: '12345',
      lng: 71.4,
      lat: 42.9,
      now,
      windowMs: 120_000,
      maxDistanceM: 40,
    });
    assert.ok(dup);
    assert.equal(dup.managerId, '17');
  });
});
