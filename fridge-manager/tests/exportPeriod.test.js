const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseExportPeriod, DEFAULT_EXPORT_PERIOD } = require('../lib/exportPeriod');

describe('parseExportPeriod', () => {
  it('defaults to month when empty', () => {
    const p = parseExportPeriod(undefined);
    assert.equal(p.key, DEFAULT_EXPORT_PERIOD);
    assert.equal(p.days, 30);
    assert.ok(p.since instanceof Date);
  });

  it('parses week, month, 6months and all', () => {
    assert.equal(parseExportPeriod('week').days, 7);
    assert.equal(parseExportPeriod('month').days, 30);
    assert.equal(parseExportPeriod('6months').days, 180);
    assert.equal(parseExportPeriod('all').since, null);
  });

  it('falls back to month for unknown values', () => {
    assert.equal(parseExportPeriod('bogus').key, 'month');
  });
});
