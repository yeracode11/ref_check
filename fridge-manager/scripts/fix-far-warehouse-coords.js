/**
 * Исправляет GPS склада/возврата: гeокод по адресу, если
 * - точка далеко от cityId, или
 * - после отметки МХО в другом регионе координаты сброшены в центр города.
 *
 *   node scripts/fix-far-warehouse-coords.js --city=02 --dry-run
 *   node scripts/fix-far-warehouse-coords.js --city=02 --apply
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Fridge = require('../models/Fridge');
const City = require('../models/City');
const Checkin = require('../models/Checkin');
const { forwardGeocodeQuery, buildGeocodeQuery } = require('../lib/nominatimGeocode');
const { isLocationNearCity, getCityFilterRadiusKm } = require('../lib/cityLocationValidation');
const { isAtCityDepotCenter } = require('../lib/fridgeReturnHelpers');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function lastCheckinLocation(fridgeId) {
  const row = await Checkin.findOne({ fridgeRef: fridgeId })
    .sort({ visitedAt: -1 })
    .select('location')
    .lean();
  return row?.location || null;
}

async function shouldFixFridge(fridge, city) {
  const addr = fridge.address && String(fridge.address).trim();
  if (!addr) return { fix: false, reason: 'no_address' };

  if (!isLocationNearCity(fridge.location, city)) {
    return { fix: true, reason: 'far_gps' };
  }

  const atDepot = isAtCityDepotCenter(fridge, city);
  if (!atDepot) return { fix: false, reason: 'ok' };

  const checkinLoc = await lastCheckinLocation(fridge._id);
  if (checkinLoc && !isLocationNearCity(checkinLoc, city)) {
    return { fix: true, reason: 'checkin_far_reset_depot' };
  }

  return { fix: false, reason: 'depot_ok' };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const cityArg = process.argv.find((a) => a.startsWith('--city='));
  const cityCode = cityArg ? cityArg.split('=')[1] : null;

  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

  const cityFilter = cityCode ? { code: cityCode } : {};
  const cities = await City.find(cityFilter).select('name code').lean();
  if (!cities.length) {
    console.error('Город не найден');
    process.exit(1);
  }

  let scanned = 0;
  let needsFix = 0;
  let geocoded = 0;
  let failed = 0;
  const byReason = {};

  for (const city of cities) {
    const radius = getCityFilterRadiusKm(city);
    const fridges = await Fridge.find({
      cityId: city._id,
      active: true,
      warehouseStatus: { $in: ['warehouse', 'returned'] },
    }).select('_id code address location warehouseStatus locationAtDepot').lean();

    for (const f of fridges) {
      scanned++;
      const { fix, reason } = await shouldFixFridge(f, city);
      if (!fix) continue;

      needsFix++;
      byReason[reason] = (byReason[reason] || 0) + 1;
      console.log(
        `${apply ? '' : '[dry-run] '}${f.code} — ${reason} (>${radius} км или отметка вне города)`,
      );

      if (!apply) continue;

      const query = buildGeocodeQuery(f.address, city.name);
      const coords = await forwardGeocodeQuery(query);
      await sleep(1100);

      if (coords && isLocationNearCity({ type: 'Point', coordinates: coords }, city)) {
        await Fridge.updateOne(
          { _id: f._id },
          { $set: { location: { type: 'Point', coordinates: coords }, locationAtDepot: false } },
        );
        geocoded++;
      } else {
        failed++;
      }
    }
  }

  console.log(JSON.stringify({ apply, scanned, needsFix, geocoded, failed, byReason }, null, 2));
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
