#!/usr/bin/env node
/**
 * Сбрасывает координаты returned/warehouse холодильников в центр их cityId.
 * Запуск: node scripts/fix-returned-fridge-locations.js [--dry-run]
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Fridge = require('../models/Fridge');
const City = require('../models/City');
const { applyReturnToHomeCity } = require('../lib/fridgeReturnHelpers');
const { resolveCityMapCenter } = require('../lib/cityMapCenters');

function haversineKm(lat1, lng1, lat2, lng2) {
  const r = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('MONGODB_URI не задан');
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log(dryRun ? '[dry-run] ' : '', 'Поиск returned/warehouse холодильников…');

  const cities = await City.find().select('name code').lean();
  const cityById = new Map(cities.map((c) => [String(c._id), c]));

  const fridges = await Fridge.find({
    warehouseStatus: { $in: ['returned', 'warehouse'] },
    cityId: { $ne: null },
  }).select('_id code name cityId warehouseStatus location address');

  let updated = 0;
  let skipped = 0;

  for (const fridge of fridges) {
    const cityDoc = cityById.get(String(fridge.cityId));
    if (!cityDoc) {
      skipped++;
      continue;
    }
    const center = resolveCityMapCenter(cityDoc.name, cityDoc.code);
    if (!center) {
      skipped++;
      continue;
    }

    const coords = fridge.location?.coordinates;
    const lng = coords?.[0];
    const lat = coords?.[1];
    const far = lat == null || lng == null
      || haversineKm(lat, lng, center.lat, center.lng) > 5;

    if (!far) {
      skipped++;
      continue;
    }

    console.log(
      `${dryRun ? '[dry-run] ' : ''}${fridge.code} (${fridge.name}) — ${cityDoc.name}, `
      + `было [${lng}, ${lat}] → центр города`,
    );

    if (!dryRun) {
      applyReturnToHomeCity(fridge, cityDoc);
      await fridge.save();
    }
    updated++;
  }

  console.log(`Готово: обновлено ${updated}, пропущено ${skipped}, всего ${fridges.length}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
