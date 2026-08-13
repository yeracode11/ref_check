const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { isAccountantExport, formatManagerLabel } = require('../lib/salesReportExport');

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

describe('formatManagerLabel', () => {
  it('prefers username for TP export labels', () => {
    assert.equal(
      formatManagerLabel({ username: '01-Кат 1', fullName: 'Иванов Иван' }, 'fallback'),
      '01-Кат 1',
    );
  });

  it('falls back to fullName then managerId', () => {
    assert.equal(formatManagerLabel({ fullName: 'Иванов Иван' }, '09'), 'Иванов Иван');
    assert.equal(formatManagerLabel(null, '09'), '09');
  });
});
