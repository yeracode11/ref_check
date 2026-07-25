/**
 * Проставляет fridgeRef на старых отметках (привязка к городу через менеджера + гео).
 *
 *   node scripts/backfill-checkin-fridge-ref.js --dry-run
 *   node scripts/backfill-checkin-fridge-ref.js --apply
 *   node scripts/backfill-checkin-fridge-ref.js --apply --fix-fridge-id
 *   node scripts/backfill-checkin-fridge-ref.js --apply --limit 5000
 *
 * MONGODB_URI из fridge-manager/.env или ENV_FILE=/path/.env
 */
const path = require('path');
const fs = require('fs');

function loadMongoUri() {
  const envFile = process.env.ENV_FILE || path.join(__dirname, '..', '.env');
  if (fs.existsSync(envFile)) {
    require('dotenv').config({ path: envFile });
  }
  if (!process.env.MONGODB_URI && !process.env.MONGO_URI && fs.existsSync(envFile)) {
    const text = fs.readFileSync(envFile, 'utf8');
    const line = text.split('\n').find((l) => /^\s*MONGODB_URI=/.test(l));
    if (line) {
      let val = line.split('=').slice(1).join('=').trim();
      val = val.replace(/^["']|["']$/g, '');
      process.env.MONGODB_URI = val;
    }
  }
  return process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/fridge_manager';
}

function parseArgs(argv) {
  const args = {
    dryRun: true,
    fixFridgeId: false,
    force: false,
    limit: 0,
    batchSize: 500,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.dryRun = false;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--fix-fridge-id') args.fixFridgeId = true;
    else if (a === '--force') args.force = true;
    else if (a === '--limit' && argv[i + 1]) args.limit = parseInt(argv[++i], 10) || 0;
    else if (a === '--batch' && argv[i + 1]) args.batchSize = parseInt(argv[++i], 10) || 500;
  }
  return args;
}

function missingFridgeRefQuery() {
  return { $or: [{ fridgeRef: null }, { fridgeRef: { $exists: false } }] };
}

async function countCheckinFridgeRefStats(Checkin) {
  const [total, withRef, withoutRef] = await Promise.all([
    Checkin.countDocuments({}),
    Checkin.countDocuments({ fridgeRef: { $exists: true, $ne: null } }),
    Checkin.countDocuments(missingFridgeRefQuery()),
  ]);
  return { total, withRef, withoutRef };
}

async function main() {
  const args = parseArgs(process.argv);
  const mongoUri = loadMongoUri();
  const mongoose = require('mongoose');
  const Checkin = require('../models/Checkin');
  const Fridge = require('../models/Fridge');
  const User = require('../models/User');
  const {
    buildFridgeCandidateIndex,
    buildManagerCityMap,
    resolveFridgeForCheckinRecord,
    buildCheckinUpdate,
  } = require('../lib/backfillCheckinFridgeRef');
  const { invalidateCheckinStatsCache } = require('../lib/checkinStatsCache');
  const { invalidateCityCheckinIdsCache } = require('../lib/cityScope');

  console.log(`[backfill-fridgeRef] dryRun=${args.dryRun} fixFridgeId=${args.fixFridgeId} force=${args.force}`);

  await mongoose.connect(mongoUri);

  try {
    const [fridges, users] = await Promise.all([
      Fridge.find({ active: { $ne: false } })
        .select('_id code number clientInfo.inn cityId location')
        .lean(),
      User.find({ role: { $in: ['manager', 'admin', 'service_manager'] } })
        .select('username cityId role')
        .lean(),
    ]);

    const fridgeIndex = buildFridgeCandidateIndex(fridges);
    const managerCityMap = buildManagerCityMap(users);

    const checkinQuery = args.force ? {} : missingFridgeRefQuery();

    const refStatsBefore = await countCheckinFridgeRefStats(Checkin);
    console.log(
      `[backfill-fridgeRef] Сейчас в БД: всего=${refStatsBefore.total}, с fridgeRef=${refStatsBefore.withRef}, без=${refStatsBefore.withoutRef}`,
    );

    const totalToScan = await Checkin.countDocuments(checkinQuery);
    console.log(`[backfill-fridgeRef] Отметок к обработке: ${totalToScan}`);

    const stats = {
      scanned: 0,
      updated: 0,
      skippedHasRef: 0,
      noMatch: 0,
      ambiguous: 0,
      byReason: {},
    };

    const cursor = Checkin.find(checkinQuery)
      .select('_id id fridgeId fridgeRef managerId location visitedAt')
      .sort({ visitedAt: -1 })
      .cursor();

    let bulk = [];
    let bulkModified = 0;
    const flush = async () => {
      if (!bulk.length) return;
      if (!args.dryRun) {
        const result = await Checkin.collection.bulkWrite(bulk, { ordered: false });
        bulkModified += result.modifiedCount || 0;
        if ((result.modifiedCount || 0) === 0 && bulk.length > 0) {
          console.warn(
            `[backfill-fridgeRef] ⚠ bulkWrite: 0 modified при ${bulk.length} операциях — проверьте git pull (models/Checkin.js) и повторите --apply`,
          );
        }
      }
      stats.updated += bulk.length;
      bulk = [];
    };

    for await (const checkin of cursor) {
      if (args.limit && stats.scanned >= args.limit) break;
      stats.scanned += 1;

      if (checkin.fridgeRef && !args.force) {
        stats.skippedHasRef += 1;
        continue;
      }

      const { fridge, reason, candidates } = resolveFridgeForCheckinRecord(
        checkin,
        fridgeIndex,
        managerCityMap,
      );

      stats.byReason[reason] = (stats.byReason[reason] || 0) + 1;

      if (!fridge) {
        if (reason === 'ambiguous') stats.ambiguous += 1;
        else stats.noMatch += 1;
        if (stats.ambiguous <= 20 && reason === 'ambiguous') {
          console.log(
            `[backfill-fridgeRef] ⚠ ambiguous id=${checkin.id} fridgeId=${checkin.fridgeId} mgr=${checkin.managerId} candidates=${candidates}`,
          );
        }
        continue;
      }

      const $set = buildCheckinUpdate(checkin, fridge, args.fixFridgeId);
      bulk.push({
        updateOne: {
          filter: { _id: checkin._id },
          update: { $set },
        },
      });

      if (bulk.length >= args.batchSize) {
        await flush();
      }
    }

    await flush();

    console.log('[backfill-fridgeRef] Итог:');
    console.log(`  scanned: ${stats.scanned}`);
    console.log(`  ${args.dryRun ? 'would_update' : 'updated'}: ${stats.updated}`);
    console.log(`  no_match: ${stats.noMatch}`);
    console.log(`  ambiguous: ${stats.ambiguous}`);
    console.log('  by_reason:', stats.byReason);
    if (!args.dryRun) {
      console.log(`  bulk_modified (MongoDB): ${bulkModified}`);
      const refStatsAfter = await countCheckinFridgeRefStats(Checkin);
      console.log(
        `[backfill-fridgeRef] После записи: с fridgeRef=${refStatsAfter.withRef}, без=${refStatsAfter.withoutRef}`,
      );
      if (stats.updated > 0 && refStatsAfter.withRef <= refStatsBefore.withRef) {
        console.error(
          '[backfill-fridgeRef] ❌ fridgeRef в БД не вырос — сделайте git pull и снова node scripts/backfill-checkin-fridge-ref.js --apply',
        );
        process.exitCode = 1;
      }
    }

    if (args.dryRun && stats.updated > 0) {
      console.log('[backfill-fridgeRef] Dry-run — добавьте --apply для записи в БД.');
    } else if (!args.dryRun && stats.updated > 0) {
      invalidateCheckinStatsCache();
      invalidateCityCheckinIdsCache();
      console.log('[backfill-fridgeRef] Кэши статистики сброшены. pm2 restart fridge-manager — по желанию.');
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('[backfill-fridgeRef] FATAL:', err);
  process.exit(1);
});
