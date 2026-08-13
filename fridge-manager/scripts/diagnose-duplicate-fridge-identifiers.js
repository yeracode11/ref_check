/**
 * Поиск дубликатов code/number/ИНН у холодильников в разных городах.
 *
 *   node scripts/diagnose-duplicate-fridge-identifiers.js
 *   node scripts/diagnose-duplicate-fridge-identifiers.js --limit 20
 */
const path = require('path');
const fs = require('fs');

function loadMongoUri() {
  const envFile = process.env.ENV_FILE || path.join(__dirname, '..', '.env');
  if (fs.existsSync(envFile)) {
    require('dotenv').config({ path: envFile });
  }
  return process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/fridge_manager';
}

function normalizeKey(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

async function aggregateDuplicates(Fridge, field, limit) {
  const pipeline = [
    { $match: { [field]: { $exists: true, $nin: [null, ''] } } },
    {
      $group: {
        _id: `$${field}`,
        count: { $sum: 1 },
        cities: { $addToSet: '$cityId' },
        ids: { $push: '$_id' },
        codes: { $push: '$code' },
      },
    },
    {
      $project: {
        key: '$_id',
        count: 1,
        cityCount: { $size: '$cities' },
        cities: 1,
        ids: { $slice: ['$ids', 5] },
      },
    },
    { $match: { count: { $gt: 1 } } },
    { $sort: { cityCount: -1, count: -1 } },
    { $limit: limit },
  ];
  return Fridge.aggregate(pipeline);
}

async function main() {
  const limit = parseInt(process.argv.find((a, i) => process.argv[i - 1] === '--limit') || '30', 10);
  const mongoose = require('mongoose');
  const Fridge = require('../models/Fridge');
  const City = require('../models/City');

  await mongoose.connect(loadMongoUri());

  try {
    const total = await Fridge.countDocuments({});
    console.log(`[duplicate-identifiers] Всего холодильников: ${total}`);

    const cities = await City.find({}).select('_id name code').lean();
    const cityNameById = new Map(cities.map((c) => [String(c._id), c.name]));

    for (const field of ['code', 'number']) {
      const dupes = await aggregateDuplicates(Fridge, field, limit);
      const crossCity = dupes.filter((d) => d.cityCount > 1);
      console.log(`\n[duplicate-identifiers] Поле «${field}»: групп с count>1 = ${dupes.length}, из них в разных городах = ${crossCity.length}`);

      for (const row of crossCity.slice(0, limit)) {
        const cityNames = row.cities.map((id) => cityNameById.get(String(id)) || String(id));
        console.log(
          `  ${field}=${JSON.stringify(row.key)} count=${row.count} cities=[${cityNames.join(', ')}] sampleIds=${row.ids.map(String).join(', ')}`,
        );
      }
    }

    const innDupes = await Fridge.aggregate([
      { $match: { 'clientInfo.inn': { $exists: true, $nin: [null, ''] } } },
      {
        $group: {
          _id: '$clientInfo.inn',
          count: { $sum: 1 },
          cities: { $addToSet: '$cityId' },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $addFields: { cityCount: { $size: '$cities' } } },
      { $match: { cityCount: { $gt: 1 } } },
      { $sort: { count: -1 } },
      { $limit: limit },
    ]);

    console.log(`\n[duplicate-identifiers] ИНН в разных городах: ${innDupes.length}`);
    for (const row of innDupes.slice(0, Math.min(10, limit))) {
      const cityNames = row.cities.map((id) => cityNameById.get(String(id)) || String(id));
      console.log(`  inn=${JSON.stringify(row._id)} count=${row.count} cities=[${cityNames.join(', ')}]`);
    }

    const allCodes = await Fridge.find({ code: { $exists: true, $ne: '' } }).select('code').lean();
    const codeKeys = new Set(allCodes.map((f) => normalizeKey(f.code)).filter(Boolean));
    console.log(`\n[duplicate-identifiers] Уникальных code (trim): ${codeKeys.size} из ${allCodes.length} записей с code`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
