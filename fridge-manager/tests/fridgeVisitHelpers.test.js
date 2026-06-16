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

describe('restricted object visit rules', () => {
  const {
    shouldIncludeInUnvisitedReport,
    shouldCountAsWithoutCheckinsInPeriod,
    shouldCountAsNeverVisited,
    visitStatusFromLastVisit,
    restrictedVisitGraceDays,
  } = require('../lib/fridgeVisitHelpers');

  it('restricted with 30 days since visit is not unvisited', () => {
    assert.equal(
      shouldIncludeInUnvisitedReport(
        { type: 'restricted' },
        { lastVisit: new Date(), daysSinceVisit: 30 },
      ),
      false,
    );
  });

  it('restricted beyond grace is unvisited', () => {
    const grace = restrictedVisitGraceDays();
    assert.equal(
      shouldIncludeInUnvisitedReport(
        { type: 'restricted' },
        { lastVisit: new Date(), daysSinceVisit: grace + 1 },
      ),
      true,
    );
  });

  it('regular object with 30 days is unvisited in report', () => {
    assert.equal(
      shouldIncludeInUnvisitedReport(
        { type: 'regular' },
        { lastVisit: new Date(), daysSinceVisit: 30 },
      ),
      true,
    );
  });

  it('restricted excluded from without-checkins and never-visited counts', () => {
    assert.equal(shouldCountAsWithoutCheckinsInPeriod({ type: 'restricted' }, false), false);
    assert.equal(shouldCountAsNeverVisited({ type: 'restricted' }, null), false);
  });

  it('restricted stays fresh on map longer than regular', () => {
    const now = new Date('2026-06-08T12:00:00.000Z').getTime();
    const visit30d = new Date(now - 30 * 86400000);
    assert.equal(visitStatusFromLastVisit(visit30d, { nowMs: now, fridgeType: 'regular' }), 'old');
    assert.equal(visitStatusFromLastVisit(visit30d, { nowMs: now, fridgeType: 'restricted' }), 'week');
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
