#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Fridge = require('../models/Fridge');
const Checkin = require('../models/Checkin');
const City = require('../models/City');

const CODE = '21200299999100290076';

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const cities = await City.find().select('name code').lean();
  const cityMap = new Map(cities.map((c) => [String(c._id), c]));

  const f = await Fridge.findOne({ code: CODE }).lean();
  console.log('fridge', f && {
    _id: f._id,
    code: f.code,
    city: cityMap.get(String(f.cityId))?.name,
    warehouseStatus: f.warehouseStatus,
    locationAtDepot: f.locationAtDepot,
    address: f.address,
    location: f.location?.coordinates,
    createdAt: f.createdAt,
  });

  const dayStart = new Date('2026-08-13T00:00:00Z');
  const dayEnd = new Date('2026-08-14T00:00:00Z');

  const addrPatterns = [
    'Еруbaева 51',
    'Еруbaeva',
    'Степногорск',
    'Уштobe',
    'Ushtobe',
    'Лисакova',
    'Lisakova',
    'Желтоксан 3',
  ];
  console.log('\n=== Aug 13 checkins by address pattern ===');
  for (const p of addrPatterns) {
    const n = await Checkin.countDocuments({
      visitedAt: { $gte: dayStart, $lt: dayEnd },
      address: { $regex: p, $options: 'i' },
    });
    if (n) console.log(p, n);
  }

  console.log('\n=== Ever linked to this code ===');
  const ever = await Checkin.find({
    $or: [{ fridgeId: CODE }, { fridgeId: { $regex: '90076$' } }],
  })
    .select('fridgeId fridgeRef visitedAt address managerId')
    .sort({ visitedAt: -1 })
    .limit(10)
    .lean();
  console.log('count sample', ever.length, ever);

  console.log('\n=== Similar fridge 72 ===');
  const f72 = await Fridge.findOne({ code: '21200299999100290072' }).lean();
  if (f72) {
    const c72 = await Checkin.countDocuments({
      $or: [{ fridgeRef: f72._id }, { fridgeId: '21200299999100290072' }],
    });
    console.log('fridge 72 checkins', c72, 'city', cityMap.get(String(f72.cityId))?.name);
    const sample72 = await Checkin.find({ fridgeRef: f72._id })
      .select('visitedAt address managerId')
      .sort({ visitedAt: -1 })
      .limit(5)
      .lean();
    console.log('sample72', sample72);
  }

  console.log('\n=== Similar serial fridges ===');
  const all = await Fridge.find({ code: { $regex: '^2120029999910029007' } })
    .select('code cityId createdAt warehouseStatus name')
    .lean();
  for (const x of all) {
    const n = await Checkin.countDocuments({ $or: [{ fridgeRef: x._id }, { fridgeId: x.code }] });
    console.log({
      code: x.code,
      city: cityMap.get(String(x.cityId))?.name,
      created: x.createdAt,
      status: x.warehouseStatus,
      checkins: n,
      name: x.name?.slice(0, 40),
    });
  }

  console.log('\n=== Aug 13 Stepnogorsk samples (any fridge) ===');
  const samples = await Checkin.find({
    visitedAt: { $gte: dayStart, $lt: dayEnd },
    address: { $regex: 'Степногорск', $options: 'i' },
  })
    .select('fridgeId fridgeRef visitedAt address managerId')
    .limit(5)
    .lean();
  console.log(samples);

  console.log('\n=== How UI would query (admin route logic) ===');
  if (f) {
    const idMatch = await Checkin.find({
      $or: [{ fridgeRef: f._id }, { fridgeId: f.code }, { fridgeId: f.number }],
    }).countDocuments();
    console.log('UI query count now', idMatch);

    const broken = await Checkin.find({
      fridgeId: { $regex: '2\\.900076|900076|00290076' },
    })
      .select('fridgeId fridgeRef visitedAt address')
      .limit(5)
      .lean();
    console.log('broken fridgeId patterns', broken);
  }

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
