const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { getLastVisitFromStatsMap } = require('../lib/fridgeVisitHelpers');

describe('getLastVisitFromStatsMap', () => {
  it('uses stats per Fridge._id only, not shared code/number keys', () => {
    const visitA = new Date('2026-01-10T08:00:00.000Z');
    const visitB = new Date('2026-03-15T14:30:00.000Z');
    const stats = new Map([
      ['id-a', { lastVisit: visitA, totalCheckins: 2 }],
      ['id-b', { lastVisit: visitB, totalCheckins: 5 }],
      // Старый баг: один bucket на общий number
      ['777', { lastVisit: visitB, totalCheckins: 99 }],
    ]);

    const fridgeA = { _id: 'id-a', code: '777', number: '777' };
    const fridgeB = { _id: 'id-b', code: '777', number: '777' };

    const a = getLastVisitFromStatsMap(stats, fridgeA);
    const b = getLastVisitFromStatsMap(stats, fridgeB);

    assert.equal(a.lastVisit.getTime(), visitA.getTime());
    assert.equal(b.lastVisit.getTime(), visitB.getTime());
    assert.equal(a.totalCheckins, 2);
    assert.equal(b.totalCheckins, 5);
  });
});
