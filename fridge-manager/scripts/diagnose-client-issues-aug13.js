#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Fridge = require('../models/Fridge');
const Checkin = require('../models/Checkin');
const City = require('../models/City');
const { buildCheckinFridgeIdMatchCondition } = require('../lib/fridgeVisitHelpers');

const CLIENT_CODES = [
  '21200299999100060147',
  'М21200299999100060147',
  '028491125067',
  '000850125028',
  'М21205410500080740082',
  '21205410500080750245',
  '21200299999100290076',
];

function oldMatchCondition(fridge) {
  const candidates = [fridge.code, fridge.number].filter(Boolean);
  const or = [];
  for (const id of candidates) {
    or.push({ fridgeId: id });
    or.push({ fridgeId: `#${String(id).replace(/^#+/, '')}` });
    const n = Number(String(id).replace(/^М/, '').replace(/^#+/, ''));
    if (Number.isFinite(n)) or.push({ fridgeId: n });
  }
  return or.length ? { $or: or } : null;
}

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const cities = await City.find().select('name code').lean();
  const cityMap = new Map(cities.map((c) => [String(c._id), c.name]));

  console.log('=== CLIENT FRIDGES ===');
  for (const code of CLIENT_CODES) {
    const f = await Fridge.findOne({ $or: [{ code }, { number: code }] }).lean();
    if (!f) {
      console.log(code, 'NOT FOUND');
      continue;
    }
    const newCond = buildCheckinFridgeIdMatchCondition(f);
    const oldCond = oldMatchCondition(f);
    const newCount = newCond ? await Checkin.countDocuments(newCond) : 0;
    const oldCount = oldCond ? await Checkin.countDocuments(oldCond) : 0;
    const byRef = await Checkin.countDocuments({ fridgeRef: f._id });
    const last = await Checkin.findOne({ fridgeRef: f._id }).sort({ visitedAt: -1 }).lean();
    console.log(JSON.stringify({
      code: f.code,
      city: cityMap.get(String(f.cityId)),
      status: f.warehouseStatus,
      coords: f.location?.coordinates,
      byRef,
      newMatch: newCount,
      oldMatch: oldCount,
      lastReal: last ? { at: last.visitedAt, address: last.address, manager: last.managerId } : null,
    }));
  }

  console.log('\n=== ROUNDED ID COLLISION POOLS (top 10) ===');
  const pools = await Checkin.aggregate([
    { $match: { fridgeId: { $type: 'double' } } },
    { $group: { _id: '$fridgeId', c: { $sum: 1 } } },
    { $match: { c: { $gte: 3 } } },
    { $sort: { c: -1 } },
    { $limit: 10 },
  ]);
  console.log(pools);

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
