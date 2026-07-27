/**
 * Топ fridgeId у отметок без fridgeRef (почему backfill не находит ХО).
 *
 *   node scripts/diagnose-orphan-checkins.js
 *   node scripts/diagnose-orphan-checkins.js --limit 30
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

async function main() {
  const limit = parseInt(process.argv.find((a, i) => process.argv[i - 1] === '--limit') || '20', 10);
  const mongoose = require('mongoose');
  const Checkin = require('../models/Checkin');
  const { normalizeFridgeIdForCompare } = require('../lib/checkinDedup');

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
      { $limit: limit },
    ]);

    console.log(`[orphan-checkins] Топ-${limit} fridgeId в «сиротах»:`);
    for (const row of top) {
      const key = normalizeFridgeIdForCompare(row._id);
      console.log(
        `  fridgeId=${JSON.stringify(row._id)} (key=${key}) count=${row.n} last=${row.lastAt ? new Date(row.lastAt).toISOString() : '—'}`,
      );
    }

    const Fridge = require('../models/Fridge');
    let matchedIfIncludeInactive = 0;
    for (const row of top.slice(0, 5)) {
      const key = normalizeFridgeIdForCompare(row._id);
      if (!key) continue;
      const n = Number(key);
      const or = [
        { code: key },
        { number: key },
        { 'clientInfo.inn': key },
      ];
      if (mongoose.isValidObjectId(key)) {
        or.push({ _id: new mongoose.Types.ObjectId(key) });
      }
      if (Number.isFinite(n)) {
        or.push({ number: String(n) }, { code: String(n) });
      }
      const hits = await Fridge.find({ $or: or }).select('_id code number active').limit(3).lean();
      console.log(`  → поиск «${key}»: найдено ХО ${hits.length}`, hits.map((h) => ({
        _id: String(h._id),
        code: h.code,
        number: h.number,
        active: h.active,
      })));
      if (hits.length) matchedIfIncludeInactive += row.n;
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
