/**
 * Удаляет отметки без fridgeRef, для которых нет подходящего холодильника (no_fridge_match).
 * Не трогает ambiguous — их нужно разбирать вручную или через backfill с fix-fridge-id.
 *
 *   node scripts/cleanup-orphan-checkins.js --dry-run
 *   node scripts/cleanup-orphan-checkins.js --apply
 *   node scripts/cleanup-orphan-checkins.js --apply --before 2024-01-01
 *   node scripts/cleanup-orphan-checkins.js --dry-run --limit 1000
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
  const args = {
    dryRun: true,
    limit: 0,
    before: null,
    batchSize: 500,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.dryRun = false;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--limit') args.limit = parseInt(argv[++i], 10) || 0;
    else if (a === '--before') args.before = new Date(argv[++i]);
    else if (a === '--batch-size') args.batchSize = parseInt(argv[++i], 10) || 500;
  }
  return args;
}

function missingFridgeRefQuery(before) {
  const q = { $or: [{ fridgeRef: null }, { fridgeRef: { $exists: false } }] };
  if (before) {
    q.visitedAt = { $lt: before };
  }
  return q;
}

async function main() {
  const args = parseArgs(process.argv);
  const mongoose = require('mongoose');
  const Checkin = require('../models/Checkin');
  const Fridge = require('../models/Fridge');
  const User = require('../models/User');
  const {
    buildFridgeCandidateIndex,
    buildManagerCityMap,
    resolveFridgeForCheckinRecord,
  } = require('../lib/backfillCheckinFridgeRef');
  const { invalidateCheckinStatsCache } = require('../lib/checkinStatsCache');
  const { invalidateCityCheckinIdsCache } = require('../lib/cityScope');

  console.log(`[cleanup-orphan-checkins] dryRun=${args.dryRun} before=${args.before ? args.before.toISOString() : '—'} limit=${args.limit || '∞'}`);

  await mongoose.connect(loadMongoUri());

  try {
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
    const query = missingFridgeRefQuery(args.before);

    const totalMissing = await Checkin.countDocuments(query);
    console.log(`[cleanup-orphan-checkins] Без fridgeRef (по фильтру): ${totalMissing}`);

    const stats = {
      scanned: 0,
      deletable: 0,
      kept: 0,
      byReason: {},
    };

    const toDelete = [];
    const cursor = Checkin.find(query)
      .select('_id fridgeId managerId location visitedAt')
      .sort({ visitedAt: 1 })
      .cursor();

    for await (const checkin of cursor) {
      if (args.limit && stats.scanned >= args.limit) break;
      stats.scanned += 1;

      const { reason } = resolveFridgeForCheckinRecord(checkin, fridgeIndex, managerCityMap);
      stats.byReason[reason] = (stats.byReason[reason] || 0) + 1;

      if (reason === 'no_fridge_match') {
        stats.deletable += 1;
        toDelete.push(checkin._id);
      } else {
        stats.kept += 1;
      }

      if (toDelete.length >= args.batchSize) {
        if (!args.dryRun) {
          await Checkin.deleteMany({ _id: { $in: toDelete } });
          invalidateCheckinStatsCache();
          invalidateCityCheckinIdsCache();
        }
        toDelete.length = 0;
      }
    }

    if (toDelete.length) {
      if (!args.dryRun) {
        await Checkin.deleteMany({ _id: { $in: toDelete } });
        invalidateCheckinStatsCache();
        invalidateCityCheckinIdsCache();
      }
    }

    console.log('[cleanup-orphan-checkins] Итог:', JSON.stringify(stats, null, 2));
    if (args.dryRun) {
      console.log('[cleanup-orphan-checkins] Запустите с --apply для удаления no_fridge_match');
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
