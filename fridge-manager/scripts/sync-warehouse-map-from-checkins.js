/**
 * Для warehouse/returned с locationAtDepot: ставит GPS из последней отметки
 * после последнего перевода на склад/возврат (statusHistory).
 *
 *   node scripts/sync-warehouse-map-from-checkins.js --dry-run
 *   node scripts/sync-warehouse-map-from-checkins.js --apply --limit 5000
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

function lastDepotTransitionAt(fridge) {
  const history = Array.isArray(fridge.statusHistory) ? fridge.statusHistory : [];
  let last = null;
  for (const row of history) {
    if (row?.status === 'warehouse' || row?.status === 'returned') {
      const t = row.changedAt ? new Date(row.changedAt).getTime() : null;
      if (t != null && (last == null || t > last)) last = t;
    }
  }
  return last;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const limit = parseInt(process.argv.find((a, i) => process.argv[i - 1] === '--limit') || '0', 10);
  const mongoose = require('mongoose');
  const Fridge = require('../models/Fridge');
  const Checkin = require('../models/Checkin');

  await mongoose.connect(loadMongoUri());

  try {
    const stats = { scanned: 0, updated: 0, noCheckin: 0, skippedOld: 0 };
    const cursor = Fridge.find({
      warehouseStatus: { $in: ['warehouse', 'returned'] },
      locationAtDepot: { $ne: false },
    })
      .select('_id code statusHistory warehouseStatus location')
      .cursor();

    for await (const fridge of cursor) {
      if (limit && stats.scanned >= limit) break;
      stats.scanned += 1;

      const since = lastDepotTransitionAt(fridge);
      const checkinQuery = { fridgeRef: fridge._id };
      if (since) {
        checkinQuery.visitedAt = { $gte: new Date(since) };
      }

      const checkin = await Checkin.findOne(checkinQuery)
        .sort({ visitedAt: -1 })
        .select('location visitedAt')
        .lean();

      if (!checkin?.location?.coordinates) {
        stats.noCheckin += 1;
        continue;
      }

      const [lng, lat] = checkin.location.coordinates;
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
        stats.skippedOld += 1;
        continue;
      }

      if (apply) {
        await Fridge.updateOne(
          { _id: fridge._id },
          {
            $set: {
              location: checkin.location,
              locationAtDepot: false,
            },
          },
        );
      }
      stats.updated += 1;
    }

    console.log('[sync-warehouse-map]', JSON.stringify({ apply, ...stats }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
