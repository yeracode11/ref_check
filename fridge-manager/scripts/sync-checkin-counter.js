#!/usr/bin/env node
/**
 * Подтягивает counters.checkin.seq до max(checkins.id).
 *
 *   node scripts/sync-checkin-counter.js
 *   node scripts/sync-checkin-counter.js --apply
 */
const path = require('path');

function loadMongoUri() {
  const envFile = process.env.ENV_FILE || path.join(__dirname, '..', '.env');
  if (require('fs').existsSync(envFile)) {
    require('dotenv').config({ path: envFile });
  }
  return process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/fridge_manager';
}

async function main() {
  const apply = process.argv.includes('--apply');
  const mongoose = require('mongoose');
  const { Counter, syncCheckinCounter, getMaxCheckinId } = require('../models/Counter');

  await mongoose.connect(loadMongoUri());
  try {
    const before = await Counter.findById('checkin').lean();
    const maxId = await getMaxCheckinId();
    console.log('[sync-checkin-counter] max(checkins.id)=', maxId, 'counter.seq=', before?.seq ?? '(none)');

    if (!apply) {
      if (!before || before.seq < maxId) {
        console.log('[sync-checkin-counter] Запустите с --apply для обновления счётчика');
      } else {
        console.log('[sync-checkin-counter] Счётчик актуален');
      }
      return;
    }

    const synced = await syncCheckinCounter();
    const after = await Counter.findById('checkin').lean();
    console.log('[sync-checkin-counter] OK seq=', after?.seq, '(was', before?.seq ?? 0, ', maxId', maxId, ')');
    if (synced !== after?.seq) {
      console.log('[sync-checkin-counter] synced value', synced);
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
