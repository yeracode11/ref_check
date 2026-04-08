const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  combinedVisitMapStatus,
  visitStatusFromLastVisit,
  mergeCheckinStatsAggregationIntoMap,
} = require('../lib/fridgeVisitHelpers');

describe('combinedVisitMapStatus', () => {
  const now = new Date('2026-04-01T12:00:00.000Z').getTime();
  const recent = new Date('2026-04-01T08:00:00.000Z'); // тот же календарный день в Almaty context

  it('returned warehouse forces never even if lastVisit exists', () => {
    const st = combinedVisitMapStatus(recent, 'returned', { nowMs: now });
    assert.equal(st, 'never');
  });

  it('installed uses visit timeliness', () => {
    const st = combinedVisitMapStatus(recent, 'installed', { nowMs: now });
    assert.equal(visitStatusFromLastVisit(recent, { nowMs: now }), st);
  });

  it('no lastVisit is never', () => {
    assert.equal(combinedVisitMapStatus(null, 'installed', { nowMs: now }), 'never');
  });
});

describe('mergeCheckinStatsAggregationIntoMap', () => {
  it('merges string and numeric _id into one key with latest lastVisit', () => {
    const older = new Date('2026-03-19T12:48:00.000Z');
    const newer = new Date('2026-04-06T15:34:00.000Z');
    const map = mergeCheckinStatsAggregationIntoMap([
      { _id: '1133', lastVisit: older, totalCheckins: 5 },
      { _id: 1133, lastVisit: newer, totalCheckins: 3 },
    ]);
    assert.equal(map.size, 1);
    const row = map.get('1133');
    assert.ok(row);
    assert.equal(row.lastVisit.getTime(), newer.getTime());
    assert.equal(row.totalCheckins, 8);
  });

  it('order-independent: numeric group first still picks newer', () => {
    const older = new Date('2026-03-19T12:48:00.000Z');
    const newer = new Date('2026-04-06T15:34:00.000Z');
    const map = mergeCheckinStatsAggregationIntoMap([
      { _id: 1133, lastVisit: newer, totalCheckins: 1 },
      { _id: '1133', lastVisit: older, totalCheckins: 2 },
    ]);
    const row = map.get('1133');
    assert.equal(row.lastVisit.getTime(), newer.getTime());
  });
});
