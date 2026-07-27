const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildVisitCategoryExportRows } = require('../lib/analyticsHelpers');

describe('buildVisitCategoryExportRows', () => {
  const now = new Date('2026-06-08T12:00:00.000Z').getTime();
  const recent = new Date(now - 2 * 86400000);
  const oldVisit = new Date(now - 30 * 86400000);

  it('splits never, old and fresh visit buckets', () => {
    const fridges = [
      {
        _id: 'f1',
        code: '100',
        name: 'Fresh',
        warehouseStatus: 'installed',
        type: 'regular',
        cityId: { name: 'Test' },
      },
      {
        _id: 'f2',
        code: '200',
        name: 'Old',
        warehouseStatus: 'installed',
        type: 'regular',
        cityId: { name: 'Test' },
      },
      {
        _id: 'f3',
        code: '300',
        name: 'Never',
        warehouseStatus: 'installed',
        type: 'regular',
        cityId: { name: 'Test' },
      },
    ];
    const stats = new Map([
      ['f1', { lastVisit: recent, totalCheckins: 5 }],
      ['f2', { lastVisit: oldVisit, totalCheckins: 2 }],
      ['f3', { lastVisit: null, totalCheckins: 0 }],
    ]);

    const { neverRows, oldRows, freshRows, scopeFridgeIds } = buildVisitCategoryExportRows(
      fridges,
      stats,
      now,
    );

    assert.equal(freshRows.length, 1);
    assert.equal(oldRows.length, 1);
    assert.equal(neverRows.length, 1);
    assert.equal(scopeFridgeIds.length, 3);
    assert.equal(freshRows[0]['Статус визита'], 'Неделя');
    assert.equal(oldRows[0]['Статус визита'], 'Давно');
    assert.equal(neverRows[0]['Статус визита'], 'Нет отметок');
  });

  it('skips fridges on warehouse', () => {
    const fridges = [{
      _id: 'f3',
      code: '300',
      warehouseStatus: 'warehouse',
      type: 'regular',
    }];
    const stats = new Map([['f3', { lastVisit: null, totalCheckins: 0 }]]);
    const { neverRows, scopeFridgeIds } = buildVisitCategoryExportRows(fridges, stats, now);
    assert.equal(neverRows.length, 0);
    assert.equal(scopeFridgeIds.length, 0);
  });
});
