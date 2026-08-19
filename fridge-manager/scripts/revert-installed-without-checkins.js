#!/usr/bin/env node
/**
 * Вернуть на склад холодильники «installed» без единой отметки (синие точки на карте).
 *
 *   node scripts/revert-installed-without-checkins.js --city 02 --dry-run
 *   node scripts/revert-installed-without-checkins.js --city 02 --apply
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const mongoose = require('mongoose');
const Fridge = require('../models/Fridge');
const Checkin = require('../models/Checkin');
const City = require('../models/City');
const { applyReturnToHomeCity } = require('../lib/fridgeReturnHelpers');

const APPLY = process.argv.includes('--apply');
const cityArg = process.argv.find((a, i) => process.argv[i - 1] === '--city') || '02';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/fridge_manager');

  const city = await City.findOne({
    $or: [{ code: String(cityArg) }, { name: new RegExp(String(cityArg), 'i') }],
  }).lean();
  if (!city) {
    console.error('City not found:', cityArg);
    process.exit(1);
  }

  const installed = await Fridge.find({
    cityId: city._id,
    warehouseStatus: 'installed',
  })
    .select('_id code name warehouseStatus locationAtDepot cityId')
    .lean();

  const toRevert = [];
  for (const f of installed) {
    const n = await Checkin.countDocuments({ fridgeRef: f._id });
    if (n === 0) toRevert.push(f);
  }

  console.log(`[revert] ${city.name}: installed=${installed.length}, revert=${toRevert.length}`);
  console.log('[revert] Sample:', toRevert.slice(0, 8).map((f) => f.code));

  if (!APPLY || !toRevert.length) {
    if (!APPLY) console.log('[revert] DRY RUN — add --apply');
    await mongoose.disconnect();
    return;
  }

  let updated = 0;
  for (const f of toRevert) {
    const doc = await Fridge.findById(f._id);
    if (!doc) continue;
    doc.warehouseStatus = 'warehouse';
    applyReturnToHomeCity(doc, city);
    doc.statusHistory = doc.statusHistory || [];
    doc.statusHistory.push({
      status: 'warehouse',
      changedAt: new Date(),
      notes: 'Авто: installed без отметок — возврат на склад (исправление карты)',
    });
    await doc.save();
    updated += 1;
  }

  console.log('[revert] Updated:', updated);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
