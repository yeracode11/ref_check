/**
 * Склад/возврат: если GPS далеко от cityId — геокод по адресу (или снова depot).
 *
 *   node scripts/fix-far-warehouse-coords.js --city=02 --dry-run
 *   node scripts/fix-far-warehouse-coords.js --city=02 --apply
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Fridge = require('../models/Fridge');
const City = require('../models/City');
const { forwardGeocodeQuery } = require('../lib/nominatimGeocode');
const { isLocationNearCity, getCityFilterRadiusKm } = require('../lib/cityLocationValidation');
const { applyReturnToHomeCity } = require('../lib/fridgeReturnHelpers');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  let far = 0;
  let geocoded = 0;
  let depot = 0;
  let failed = 0;

  for (const city of cities) {
    const radius = getCityFilterRadiusKm(city);
    const fridges = await Fridge.find({
      cityId: city._id,
      active: true,
      warehouseStatus: { $in: ['warehouse', 'returned'] },
      locationAtDepot: false,
    }).select('_id code address location warehouseStatus').lean();

    for (const f of fridges) {
      scanned++;
      if (isLocationNearCity(f.location, city)) continue;
      far++;

      const addr = f.address && String(f.address).trim();
      console.log(
        `${apply ? '' : '[dry-run] '}${f.code} — далеко от ${city.name} (>${radius} км)`,
      );

      if (!apply) continue;

      if (addr) {
        const query = `${addr}, ${city.name}, Казахстан`;
        const coords = await forwardGeocodeQuery(query);
        await sleep(1100);
        if (coords && isLocationNearCity({ type: 'Point', coordinates: coords }, city)) {
          await Fridge.updateOne(
            { _id: f._id },
            { $set: { location: { type: 'Point', coordinates: coords }, locationAtDepot: false } },
          );
          geocoded++;
          continue;
        }
      }

      const doc = await Fridge.findById(f._id);
      if (doc) {
        applyReturnToHomeCity(doc, city);
        await doc.save();
        depot++;
      } else {
        failed++;
      }
    }
  }

  console.log(JSON.stringify({ apply, scanned, far, geocoded, depot, failed }, null, 2));
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
