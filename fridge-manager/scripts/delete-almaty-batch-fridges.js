#!/usr/bin/env node
/**
 * Удаление пакета холодильников Алматы (склад Рыскулова + дубли клиентов).
 *
 *   node scripts/delete-almaty-batch-fridges.js --dry-run
 *   node scripts/delete-almaty-batch-fridges.js --apply
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const mongoose = require('mongoose');
const Fridge = require('../models/Fridge');
const Checkin = require('../models/Checkin');
const Repair = require('../models/Repair');
const City = require('../models/City');

const APPLY = process.argv.includes('--apply');
const DRY = process.argv.includes('--dry-run') || !APPLY;

function buildDeleteFilter(cityId) {
  return {
    cityId,
    $or: [
      { address: /Рыскулова,\s*(д\.|дом\s*№?\s*)?97/i },
      { address: /Рыскулова.*97/i },
      { name: /Sales\s*&\s*Distribution\s*Group/i },
      { name: /Амита\s*Плюс/i },
    ],
  };
}

async function main() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/fridge_manager';
  await mongoose.connect(uri);

  const city = await City.findOne({ $or: [{ code: '02' }, { name: /^Алмат/i }] }).lean();
  if (!city) {
    console.error('City Алматы not found');
    process.exit(1);
  }

  const filter = buildDeleteFilter(city._id);
  const fridges = await Fridge.find(filter).select('_id code name address').lean();
  const ids = fridges.map((f) => f._id);
  const objectIds = ids.filter((id) => mongoose.Types.ObjectId.isValid(String(id)));

  console.log(`[delete-almaty] City: ${city.name} (${city._id})`);
  console.log(`[delete-almaty] Fridges matched: ${ids.length} (valid ObjectId: ${objectIds.length})`);
  console.log('[delete-almaty] Sample:', fridges.slice(0, 5).map((f) => `${f.code} | ${f.name}`));

  if (!ids.length) {
    await mongoose.disconnect();
    return;
  }

  const checkins = await Checkin.countDocuments({ fridgeRef: { $in: ids } });
  const repairs = await Repair.countDocuments({ fridgeId: { $in: ids } });
  console.log(`[delete-almaty] Related checkins: ${checkins}, repairs: ${repairs}`);

  if (DRY) {
    console.log('[delete-almaty] DRY RUN — add --apply to delete');
    await mongoose.disconnect();
    return;
  }

  const checkinDel = await Checkin.deleteMany({ fridgeRef: { $in: objectIds } });
  const repairDel = await Repair.collection.deleteMany({
    fridgeId: { $in: [...objectIds, ...fridges.map((f) => f.code).filter(Boolean)] },
  });
  const fridgeDel = await Fridge.deleteMany(filter);

  console.log('[delete-almaty] Deleted:', {
    checkins: checkinDel.deletedCount,
    repairs: repairDel.deletedCount,
    fridges: fridgeDel.deletedCount,
  });

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
