const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isAccountantExport } = require('../lib/salesReportExport');

describe('isAccountantExport', () => {
  it('returns true for accountant role by default', () => {
    assert.equal(isAccountantExport({ role: 'accountant' }), true);
    assert.equal(isAccountantExport({ role: 'admin' }), false);
  });

  it('respects explicit accountantExport override', () => {
    assert.equal(isAccountantExport({ role: 'admin' }, { accountantExport: true }), true);
    assert.equal(isAccountantExport({ role: 'accountant' }, { accountantExport: false }), false);
  });
});
