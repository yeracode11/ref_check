const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const Fridge = require('../models/Fridge');
const {
  userCanAccessCity,
  userCanAccessFridge,
  resolveFridgeCityId,
  findFridgeByIdentifier,
  resolveFridgeDocumentByIdOrIdentifier,
  normalizeCityId,
} = require('../lib/cityScope');

describe('cityScope access', () => {
  const cityId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
  const otherCityId = new mongoose.Types.ObjectId('507f1f77bcf86cd799439012');
  const accountant = { role: 'accountant', cityId };

  it('normalizeCityId handles populated object and rejects [object Object]', () => {
    assert.equal(normalizeCityId({ _id: cityId }).toString(), cityId.toString());
    assert.equal(normalizeCityId('[object Object]'), null);
    assert.equal(normalizeCityId(cityId.toString()).toString(), cityId.toString());
  });

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

  it('findFridgeByIdentifier scopes by cityId', async () => {
    const cityA = new mongoose.Types.ObjectId();
    const cityB = new mongoose.Types.ObjectId();
    const originalFind = Fridge.find;
    Fridge.find = (query) => ({
      limit: () => ({
        lean: async () => {
          assert.equal(String(query.cityId), String(cityA));
          return [{ _id: new mongoose.Types.ObjectId(), cityId: cityA, code: 'X1' }];
        },
      }),
    });
    try {
      const f = await findFridgeByIdentifier('X1', { cityId: cityA });
      assert.ok(f);
      assert.equal(String(f.cityId), String(cityA));
    } finally {
      Fridge.find = originalFind;
    }
  });

  it('findFridgeByIdentifier returns null when same code exists in multiple cities', async () => {
    const originalFind = Fridge.find;
    Fridge.find = () => ({
      limit: () => ({
        lean: async () => ([
          { _id: new mongoose.Types.ObjectId(), code: 'DUP' },
          { _id: new mongoose.Types.ObjectId(), code: 'DUP' },
        ]),
      }),
    });
    try {
      assert.equal(await findFridgeByIdentifier('DUP'), null);
    } finally {
      Fridge.find = originalFind;
    }
  });

  it('admin always has access', () => {
    assert.equal(userCanAccessFridge({ role: 'admin' }, { cityId: otherCityId }), true);
  });

  it('resolveFridgeDocumentByIdOrIdentifier falls back to identifier for accountant', async () => {
    const fridgeOid = new mongoose.Types.ObjectId();
    const originalFindById = Fridge.findById;
    const originalFind = Fridge.find;

    Fridge.findById = async (id) => {
      if (String(id) === String(fridgeOid)) {
        return { _id: fridgeOid, cityId, code: 'LONG-SERIAL' };
      }
      return null;
    };
    Fridge.find = (query) => ({
      limit: () => ({
        lean: async () => {
          assert.equal(String(query.cityId), String(cityId));
          return [{ _id: fridgeOid, cityId, code: 'LONG-SERIAL' }];
        },
      }),
    });

    try {
      const bySerial = await resolveFridgeDocumentByIdOrIdentifier('140306000270002624471405121081', accountant);
      assert.ok(bySerial);
      assert.equal(String(bySerial._id), String(fridgeOid));
    } finally {
      Fridge.findById = originalFindById;
      Fridge.find = originalFind;
    }
  });
});
