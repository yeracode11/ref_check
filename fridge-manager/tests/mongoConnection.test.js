const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  isMongoNetworkError,
  mongoUnavailablePayload,
} = require('../lib/mongoConnection');

describe('mongoConnection', () => {
  it('detects ECONNREFUSED network errors', () => {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:27017');
    err.name = 'MongoServerSelectionError';
    err.cause = { code: 'ECONNREFUSED' };
    assert.equal(isMongoNetworkError(err), true);
  });

  it('returns structured unavailable payload', () => {
    const p = mongoUnavailablePayload();
    assert.equal(p.code, 'MONGO_UNAVAILABLE');
    assert.match(p.details, /mongod/);
  });
});
