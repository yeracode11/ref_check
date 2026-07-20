const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeOrigin,
  expandOriginVariants,
  buildAllowedOriginSet,
  createCorsOriginChecker,
} = require('../lib/corsOrigins');

describe('corsOrigins', () => {
  it('normalizeOrigin strips trailing slash and lowercases', () => {
    assert.equal(normalizeOrigin('https://StellRef.KZ/'), 'https://stellref.kz');
  });

  it('expandOriginVariants adds www and non-www', () => {
    const variants = expandOriginVariants('https://stellref.kz');
    assert.ok(variants.includes('https://stellref.kz'));
    assert.ok(variants.includes('https://www.stellref.kz'));
  });

  it('buildAllowedOriginSet expands comma-separated entries', () => {
    const { allowAll, origins } = buildAllowedOriginSet('https://stellref.kz');
    assert.equal(allowAll, false);
    assert.ok(origins.has('https://stellref.kz'));
    assert.ok(origins.has('https://www.stellref.kz'));
  });

  it('createCorsOriginChecker allows matching origin', (t, done) => {
    const check = createCorsOriginChecker('https://stellref.kz');
    check('https://www.stellref.kz/', (err, allowed) => {
      assert.equal(err, null);
      assert.equal(allowed, true);
      done();
    });
  });

  it('createCorsOriginChecker rejects unknown origin without Error', (t, done) => {
    const check = createCorsOriginChecker('https://stellref.kz');
    check('https://evil.example.com', (err, allowed) => {
      assert.equal(err, null);
      assert.equal(allowed, false);
      done();
    });
  });

  it('createCorsOriginChecker allows requests without Origin', (t, done) => {
    const check = createCorsOriginChecker('https://stellref.kz');
    check(undefined, (err, allowed) => {
      assert.equal(err, null);
      assert.equal(allowed, true);
      done();
    });
  });
});
