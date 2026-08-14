#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Fridge = require('../models/Fridge');
const Checkin = require('../models/Checkin');

const CODE = process.argv[2] || '21200299999100290076';

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const f = await Fridge.findOne({ code: CODE }).lean();
  if (!f) {
    console.log('fridge not found');
    process.exit(1);
  }

  console.log('fridge', { _id: f._id, code: f.code, cityId: f.cityId, createdAt: f.createdAt });

  const byRef = await Checkin.countDocuments({ fridgeRef: f._id });
  const byCode = await Checkin.countDocuments({ fridgeId: CODE });
  console.log('checkins by fridgeRef', byRef, 'by fridgeId', byCode);

  const aug13Count = await Checkin.countDocuments({
    visitedAt: { $gte: new Date('2026-08-13T00:00:00Z'), $lt: new Date('2026-08-14T00:00:00Z') },
  });
  console.log('checkins on 2026-08-13 total', aug13Count);

  const addresses = ['Ерубаева', 'Еруbayeva', 'Степногорск', 'Stepnogorsk', 'Уштобе', 'Ushtobe', 'Лисакова'];
  for (const a of addresses) {
    const n = await Checkin.countDocuments({ address: { $regex: a, $options: 'i' } });
    if (n) console.log(`checkins with "${a}":`, n);
  }

  const coords = [
    { name: 'Karaganda', lng: 73.182599, lat: 49.804963 },
    { name: 'Stepnogorsk', lng: 71.942161, lat: 52.448832 },
    { name: 'Ushtobe', lng: 77.977192, lat: 45.247927 },
  ];
  for (const p of coords) {
    const c = await Checkin.findOne({
      'location.coordinates.0': { $gte: p.lng - 0.002, $lte: p.lng + 0.002 },
      'location.coordinates.1': { $gte: p.lat - 0.002, $lte: p.lat + 0.002 },
    }).select('fridgeId fridgeRef visitedAt address managerId').lean();
    console.log('near', p.name, c);
  }

  // orphan checkins with this fridgeId
  const orphans = await Checkin.find({
    fridgeId: CODE,
    $or: [{ fridgeRef: null }, { fridgeRef: { $exists: false } }],
  }).countDocuments();
  console.log('orphan checkins with fridgeId code', orphans);

  await mongoose.disconnect();
})();
