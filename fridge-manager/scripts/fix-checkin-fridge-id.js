/**
 * Проставляет корректный строковый fridgeId на отметках с fridgeRef
 * (исправляет scientific notation от старого Number()).
 *
 *   node scripts/fix-checkin-fridge-id.js --dry-run
 *   node scripts/fix-checkin-fridge-id.js --apply
 *   node scripts/fix-checkin-fridge-id.js --apply --limit 5000
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
  const args = { dryRun: true, limit: 0, batchSize: 500 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.dryRun = false;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--limit') args.limit = parseInt(argv[++i], 10) || 0;
    else if (a === '--batch-size') args.batchSize = parseInt(argv[++i], 10) || 500;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const mongoose = require('mongoose');
  const Checkin = require('../models/Checkin');
  const Fridge = require('../models/Fridge');
  const { canonicalCheckinFridgeId, bareFridgeId } = require('../lib/fridgeIdFormat');
  const { invalidateCheckinStatsCache } = require('../lib/checkinStatsCache');
  const { invalidateCityCheckinIdsCache } = require('../lib/cityScope');

  console.log(`[fix-checkin-fridge-id] dryRun=${args.dryRun} limit=${args.limit || '∞'}`);

  await mongoose.connect(loadMongoUri());

  try {
    const query = { fridgeRef: { $exists: true, $ne: null } };
    const total = await Checkin.countDocuments(query);
    console.log(`[fix-checkin-fridge-id] С fridgeRef: ${total}`);

    const fridgeCache = new Map();
    const stats = { scanned: 0, updated: 0, skipped: 0, noFridge: 0 };

    const cursor = Checkin.find(query)
      .select('_id id fridgeId fridgeRef')
      .sort({ visitedAt: -1 })
      .cursor();

    let bulk = [];

    const flush = async () => {
      if (!bulk.length) return;
      if (!args.dryRun) {
        await Checkin.collection.bulkWrite(bulk, { ordered: false });
        invalidateCheckinStatsCache();
      }
      stats.updated += bulk.length;
      bulk = [];
    };

    for await (const checkin of cursor) {
      if (args.limit && stats.scanned >= args.limit) break;
      stats.scanned += 1;

      const refKey = String(checkin.fridgeRef);
      let fridge = fridgeCache.get(refKey);
      if (!fridge) {
        fridge = await Fridge.findById(checkin.fridgeRef)
          .select('_id code number')
          .lean();
        if (fridge) fridgeCache.set(refKey, fridge);
      }
      if (!fridge) {
        stats.noFridge += 1;
        continue;
      }

      const canonical = canonicalCheckinFridgeId(fridge, bareFridgeId(checkin.fridgeId));
      const current = bareFridgeId(checkin.fridgeId);
      const canonicalBare = bareFridgeId(canonical);

      if (current === canonicalBare && typeof checkin.fridgeId !== 'number') {
        stats.skipped += 1;
        continue;
      }
      if (String(checkin.fridgeId) === String(canonical) && typeof checkin.fridgeId === 'string') {
        stats.skipped += 1;
        continue;
      }

      bulk.push({
        updateOne: {
          filter: { _id: checkin._id },
          update: { $set: { fridgeId: canonicalBare } },
        },
      });

      if (bulk.length >= args.batchSize) {
        await flush();
      }
    }

    await flush();
    console.log('[fix-checkin-fridge-id] Итог:', JSON.stringify(stats, null, 2));

    if (!args.dryRun) {
      invalidateCityCheckinIdsCache();
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
