const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { combinedVisitMapStatus, visitStatusFromLastVisit } = require('../lib/fridgeVisitHelpers');

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
