const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { escapeRegExp, buildCaseInsensitiveRegex } = require('../lib/stringHelpers');

describe('stringHelpers', () => {
  it('escapeRegExp treats regex metacharacters literally', () => {
    assert.equal(escapeRegExp('a(b)*'), 'a\\(b\\)\\*');
  });

  it('buildCaseInsensitiveRegex matches substring safely', () => {
    const re = buildCaseInsensitiveRegex('SN Market');
    assert.ok(re.test('Akylbekov ИП  маг. SN Market'));
    assert.ok(!buildCaseInsensitiveRegex('(').test('broken'));
  });
});
