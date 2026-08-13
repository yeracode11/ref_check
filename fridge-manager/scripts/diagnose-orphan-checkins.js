/**
 * Анализ отметок без fridgeRef: топ fridgeId и разбивка по reason backfill.
 *
 *   node scripts/diagnose-orphan-checkins.js
 *   node scripts/diagnose-orphan-checkins.js --limit 30
 *   node scripts/diagnose-orphan-checkins.js --sample 5000
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

function parseArgs(argv) {
  const args = { limit: 20, sample: 0 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') args.limit = parseInt(argv[++i], 10) || 20;
    else if (a === '--sample') args.sample = parseInt(argv[++i], 10) || 0;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const mongoose = require('mongoose');
  const Checkin = require('../models/Checkin');
  const Fridge = require('../models/Fridge');
  const User = require('../models/User');
  const { normalizeFridgeIdForCompare } = require('../lib/checkinDedup');
  const {
    buildFridgeCandidateIndex,
    buildManagerCityMap,
    resolveFridgeForCheckinRecord,
  } = require('../lib/backfillCheckinFridgeRef');

  await mongoose.connect(loadMongoUri());

  try {
    const missing = { $or: [{ fridgeRef: null }, { fridgeRef: { $exists: false } }] };
    const total = await Checkin.countDocuments(missing);
    console.log(`[orphan-checkins] Без fridgeRef: ${total}`);

    const top = await Checkin.aggregate([
      { $match: missing },
      {
        $group: {
          _id: '$fridgeId',
          n: { $sum: 1 },
          lastAt: { $max: '$visitedAt' },
        },
      },
      { $sort: { n: -1 } },
      { $limit: args.limit },
    ]);

    console.log(`[orphan-checkins] Топ-${args.limit} fridgeId в «сиротах»:`);
    for (const row of top) {
      const key = normalizeFridgeIdForCompare(row._id);
      console.log(
        `  fridgeId=${JSON.stringify(row._id)} (key=${key}) count=${row.n} last=${row.lastAt ? new Date(row.lastAt).toISOString() : '—'}`,
      );
    }

    const [fridges, users] = await Promise.all([
      Fridge.find({})
        .select('_id code number clientInfo.inn cityId location active')
        .lean(),
      User.find({ role: { $in: ['manager', 'admin', 'service_manager'] } })
        .select('username cityId role')
        .lean(),
    ]);
    const fridgeIndex = buildFridgeCandidateIndex(fridges);
    const managerCityMap = buildManagerCityMap(users);

    const sampleSize = args.sample || Math.min(total, 10000);
    console.log(`\n[orphan-checkins] Разбивка по reason (выборка до ${sampleSize}):`);

    const byReason = {};
    let scanned = 0;
    const cursor = Checkin.find(missing)
      .select('_id fridgeId managerId location visitedAt')
      .sort({ visitedAt: -1 })
      .cursor();

    for await (const checkin of cursor) {
      if (scanned >= sampleSize) break;
      scanned += 1;
      const { reason } = resolveFridgeForCheckinRecord(checkin, fridgeIndex, managerCityMap);
      byReason[reason] = (byReason[reason] || 0) + 1;
    }

    for (const [reason, n] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
      const pct = ((n / scanned) * 100).toFixed(1);
      console.log(`  ${reason}: ${n} (${pct}%)`);
    }
    console.log(`[orphan-checkins] Просканировано: ${scanned}`);

    console.log('\n[orphan-checkins] Проверка топ-5 fridgeId в коллекции Fridge:');
    for (const row of top.slice(0, 5)) {
      const key = normalizeFridgeIdForCompare(row._id);
      if (!key) continue;
      const n = Number(key);
      const or = [{ code: key }, { number: key }, { 'clientInfo.inn': key }];
      if (mongoose.isValidObjectId(key)) {
        or.push({ _id: new mongoose.Types.ObjectId(key) });
      }
      if (Number.isFinite(n)) {
        or.push({ number: String(n) }, { code: String(n) });
      }
      const hits = await Fridge.find({ $or: or }).select('_id code number active cityId').limit(3).lean();
      console.log(`  → поиск «${key}»: найдено ХО ${hits.length}`, hits.map((h) => ({
        _id: String(h._id),
        code: h.code,
        number: h.number,
        active: h.active,
        cityId: String(h.cityId),
      })));
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
