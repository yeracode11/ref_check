/**
 * Склад/возврат: гeокод по адресу, если GPS далеко от cityId или точка-заглушка в центре.
 *
 *   node scripts/fix-far-warehouse-coords.js --city=02 --dry-run
 *   node scripts/fix-far-warehouse-coords.js --city=02 --apply
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Fridge = require('../models/Fridge');
const City = require('../models/City');
const { forwardGeocodeQuery, buildGeocodeQuery } = require('../lib/nominatimGeocode');
const { isLocationNearCity, getCityFilterRadiusKm } = require('../lib/cityLocationValidation');
const { isAtCityDepotCenter } = require('../lib/fridgeReturnHelpers');

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
  let needsFix = 0;
  let geocoded = 0;
  let noAddress = 0;
  let failed = 0;

  for (const city of cities) {
    const radius = getCityFilterRadiusKm(city);
    const fridges = await Fridge.find({
      cityId: city._id,
      active: true,
      warehouseStatus: { $in: ['warehouse', 'returned'] },
    }).select('_id code address location warehouseStatus locationAtDepot').lean();

    for (const f of fridges) {
      scanned++;
      const addr = f.address && String(f.address).trim();
      const far = !isLocationNearCity(f.location, city);
      const atDepotStub = isAtCityDepotCenter(f, city)
        && (f.locationAtDepot !== false || far);

      if (!far && !atDepotStub) continue;
      needsFix++;

      console.log(
        `${apply ? '' : '[dry-run] '}${f.code} — `
        + (far ? `GPS >${radius} км` : 'заглушка в центре'),
      );

      if (!apply) continue;

      if (!addr) {
        noAddress++;
        continue;
      }

      const query = buildGeocodeQuery(addr, city.name);
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

  console.log(JSON.stringify({ apply, scanned, needsFix, geocoded, noAddress, failed }, null, 2));
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
