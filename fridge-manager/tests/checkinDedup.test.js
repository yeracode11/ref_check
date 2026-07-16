const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  fridgeIdsEquivalent,
  fridgeIdMatchesCandidates,
  managerIdMatchesCandidates,
  canonicalCheckinFridgeId,
} = require('../lib/checkinDedup');

describe('checkinDedup', () => {
  it('fridgeIdsEquivalent treats string and number forms as same', () => {
    assert.ok(fridgeIdsEquivalent('12345', 12345));
    assert.ok(fridgeIdsEquivalent('#12345', '12345'));
  });

  it('fridgeIdMatchesCandidates matches any candidate alias', () => {
    assert.ok(fridgeIdMatchesCandidates(12345, ['12345', '#12345']));
    assert.ok(!fridgeIdMatchesCandidates('99999', ['12345']));
  });

  it('managerIdMatchesCandidates matches username or _id', () => {
    const candidates = ['17', '507f1f77bcf86cd799439011'];
    assert.ok(managerIdMatchesCandidates('17', candidates));
    assert.ok(managerIdMatchesCandidates('507f1f77bcf86cd799439011', candidates));
    assert.ok(!managerIdMatchesCandidates('99', candidates));
  });

  it('canonicalCheckinFridgeId prefers numeric number field', () => {
    assert.equal(
      canonicalCheckinFridgeId({ code: 'ABC', number: '12345' }, 'ABC'),
      12345,
    );
    assert.equal(
      canonicalCheckinFridgeId({ code: 'ABC' }, 'ABC'),
      'ABC',
    );
  });
});
