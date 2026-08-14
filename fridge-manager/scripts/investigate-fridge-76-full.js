#!/usr/bin/env node
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Fridge = require('../models/Fridge');
const Checkin = require('../models/Checkin');
const { buildCheckinFridgeIdMatchCondition, buildCheckinFridgeIdCandidates } = require('../lib/fridgeVisitHelpers');

const CODE = '21200299999100290076';

(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const f = await Fridge.findOne({ code: CODE }).lean();
  console.log('full fridge keys', Object.keys(f));
  console.log('code', f.code, 'number', f.number, 'inn', f.clientInfo?.inn);

  const byRef = await Checkin.countDocuments({ fridgeRef: f._id });
  console.log('checkins by fridgeRef', byRef);

  const cond = buildCheckinFridgeIdMatchCondition(f);
  console.log('candidates', buildCheckinFridgeIdCandidates(f));
  console.log('match cond', cond);
  const byId = await Checkin.countDocuments(cond);
  console.log('checkins by id match', byId);

  const loose = await Checkin.countDocuments({ fridgeId: { $regex: '90076$' } });
  console.log('loose suffix 90076', loose);

  const sci = Number(CODE);
  console.log('JS Number of code', sci);
  const sciCount = await Checkin.countDocuments({ fridgeId: sci });
  console.log('checkins with numeric sci', sciCount);
  const sciStrCount = await Checkin.countDocuments({ fridgeId: String(sci) });
  console.log('checkins with string sci', sciStrCount);

  // Aug 13 visits for manager 19 (from screenshot pattern)
  const dayStart = new Date('2026-08-13T00:00:00Z');
  const dayEnd = new Date('2026-08-14T00:00:00Z');
  const aug13 = await Checkin.find({
    visitedAt: { $gte: dayStart, $lt: dayEnd },
    address: { $regex: 'Еруbaева|Степногорск|Уштobe|Лисакova', $options: 'i' },
  })
    .select('fridgeId fridgeRef visitedAt address managerId')
    .sort({ visitedAt: -1 })
    .limit(20)
    .lean();
  console.log('Aug13 multi-city samples', aug13.length, aug13.slice(0, 5));

  // Would OLD code with fridgeRef OR match show 50?
  const combined = await Checkin.countDocuments({
    $or: [{ fridgeRef: f._id }, ...(cond?.$or || [])],
  });
  console.log('combined fridgeRef OR idMatch', combined);

  await mongoose.disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
