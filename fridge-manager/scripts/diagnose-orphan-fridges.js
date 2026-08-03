/**
 * Холодильники-сироты: без cityId или с cityId на несуществующий город.
 *
 *   node scripts/diagnose-orphan-fridges.js
 *   node scripts/diagnose-orphan-fridges.js --limit 50
 *   node scripts/diagnose-orphan-fridges.js --include-inactive
 *   node scripts/diagnose-orphan-fridges.js --export /tmp/orphan-fridges.json
 */
const path = require('path');
const fs = require('fs');

function loadMongoUri() {
  const envFile = process.env.ENV_FILE || path.join(__dirname, '..', '.env');
  if (fs.existsSync(envFile)) {
    require('dotenv').config({ path: envFile });
  }
  return process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/fridge_manager';
}

function parseArgs() {
  const args = {
    limit: 30,
    includeInactive: false,
    exportPath: null,
  };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--include-inactive') args.includeInactive = true;
    else if (a === '--limit') args.limit = parseInt(process.argv[++i], 10) || 30;
    else if (a === '--export') args.exportPath = process.argv[++i];
  }
  return args;
}

async function main() {
  const opts = parseArgs();
  const mongoose = require('mongoose');
  const Fridge = require('../models/Fridge');
  const City = require('../models/City');

  await mongoose.connect(loadMongoUri());

  try {
    const baseFilter = opts.includeInactive ? {} : { active: { $ne: false } };
    const cities = await City.find({}).select('_id name code active').lean();
    const cityIds = new Set(cities.map((c) => String(c._id)));
    const cityById = new Map(cities.map((c) => [String(c._id), c]));

    const missingCityFilter = {
      ...baseFilter,
      $or: [{ cityId: null }, { cityId: { $exists: false } }],
    };

    const [totalActive, totalAll, missingCount, allFridgesWithCity] = await Promise.all([
      Fridge.countDocuments({ active: { $ne: false } }),
      Fridge.countDocuments({}),
      Fridge.countDocuments(missingCityFilter),
      Fridge.find({
        ...baseFilter,
        cityId: { $exists: true, $ne: null },
      }).select('_id cityId').lean(),
    ]);

    let invalidCityCount = 0;
    const invalidByCityId = new Map();
    for (const f of allFridgesWithCity) {
      const id = String(f.cityId);
      if (!cityIds.has(id)) {
        invalidCityCount++;
        invalidByCityId.set(id, (invalidByCityId.get(id) || 0) + 1);
      }
    }

    const orphanCount = missingCount + invalidCityCount;

    console.log('=== Диагностика cityId у холодильников ===');
    console.log(`Всего ХО (active):     ${totalActive}`);
    console.log(`Всего ХО (все):        ${totalAll}`);
    console.log(`Городов в справочнике: ${cities.length}`);
    console.log('');
    console.log(`Без cityId (null):     ${missingCount}`);
    console.log(`cityId → нет в City:   ${invalidCityCount}`);
    console.log(`ИТОГО сирот:           ${orphanCount}`);
    console.log('');

    if (invalidByCityId.size > 0) {
      console.log('Битые cityId (ссылка на удалённый/несуществующий город):');
      const sorted = [...invalidByCityId.entries()].sort((a, b) => b[1] - a[1]);
      for (const [deadId, n] of sorted.slice(0, 15)) {
        console.log(`  ${deadId}  →  ${n} холодильников`);
      }
      console.log('');
    }

    const distribution = await Fridge.aggregate([
      { $match: baseFilter },
      {
        $group: {
          _id: '$cityId',
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
    ]);

    console.log('Распределение по городам (топ-20):');
    for (const row of distribution.slice(0, 20)) {
      if (row._id == null) {
        console.log(`  [БЕЗ ГОРОДА]  ${row.count}`);
        continue;
      }
      const city = cityById.get(String(row._id));
      const label = city ? `${city.name} (${city.code})` : `[НЕТ В City] ${row._id}`;
      console.log(`  ${label}  ${row.count}`);
    }
    console.log('');

    const orphans = await Fridge.find({
      ...baseFilter,
      $or: [
        { cityId: null },
        { cityId: { $exists: false } },
        { cityId: { $nin: cities.map((c) => c._id) } },
      ],
    })
      .select('_id code number name address cityId active warehouseStatus')
      .sort({ code: 1 })
      .limit(opts.limit)
      .lean();

    console.log(`Примеры сирот (до ${opts.limit}):`);
    if (!orphans.length) {
      console.log('  (нет)');
    } else {
      for (const f of orphans) {
        const cityNote = f.cityId == null
          ? 'cityId=null'
          : `cityId=${String(f.cityId)} (нет в City)`;
        console.log(
          `  ${f.code} | ${f.name?.slice(0, 40) || '—'} | ${cityNote} | active=${f.active !== false}`,
        );
      }
    }

    if (opts.exportPath) {
      const fullExport = await Fridge.find({
        ...baseFilter,
        $or: [
          { cityId: null },
          { cityId: { $exists: false } },
          { cityId: { $nin: cities.map((c) => c._id) } },
        ],
      })
        .select('_id code number name address cityId active warehouseStatus location')
        .sort({ code: 1 })
        .lean();

      fs.writeFileSync(opts.exportPath, JSON.stringify({
        generatedAt: new Date().toISOString(),
        summary: {
          totalActive,
          missingCityId: missingCount,
          invalidCityId: invalidCityCount,
          orphanTotal: orphanCount,
        },
        items: fullExport.map((f) => ({
          ...f,
          _id: String(f._id),
          cityId: f.cityId ? String(f.cityId) : null,
        })),
      }, null, 2));
      console.log('');
      console.log(`Экспорт: ${opts.exportPath} (${fullExport.length} записей)`);
    }

    if (orphanCount > 0) {
      process.exitCode = 2;
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
