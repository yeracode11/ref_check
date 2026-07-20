const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const {
  userCanAccessCity,
  userCanAccessFridge,
  resolveFridgeCityId,
} = require('../lib/cityScope');

describe('cityScope access', () => {
  const cityId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
  const otherCityId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439012');
  const accountant = { role: 'accountant', cityId };

  it('userCanAccessCity compares ObjectId and string safely', () => {
    assert.equal(userCanAccessCity(accountant, cityId.toString()), true);
    assert.equal(userCanAccessCity(accountant, otherCityId), false);
  });

  it('userCanAccessFridge handles populated cityId', () => {
    const fridge = {
      cityId: { _id: cityId, name: 'Алматы', code: 'ALA' },
    };
    assert.equal(userCanAccessFridge(accountant, fridge), true);
    assert.equal(resolveFridgeCityId(fridge).toString(), cityId.toString());
  });

  it('userCanAccessFridge handles Mongoose-style getter cityId (not own property)', () => {
    const fridgeLikeMongoose = { _id: new mongoose.Types.ObjectId() };
    Object.setPrototypeOf(fridgeLikeMongoose, {
      get cityId() {
        return { _id: cityId, name: 'Test', code: 'T' };
      },
    });
    assert.equal(userCanAccessFridge(accountant, fridgeLikeMongoose), true);
  });

  it('resolveFridgeCityId does not treat whole fridge as city id', () => {
    const fridgeLikeMongoose = { _id: new mongoose.Types.ObjectId() };
    Object.setPrototypeOf(fridgeLikeMongoose, {
      get cityId() {
        return { _id: cityId, name: 'Test', code: 'T' };
      },
    });
    assert.equal(String(resolveFridgeCityId(fridgeLikeMongoose)), cityId.toString());
  });

  it('admin always has access', () => {
    assert.equal(userCanAccessFridge({ role: 'admin' }, { cityId: otherCityId }), true);
  });
});
