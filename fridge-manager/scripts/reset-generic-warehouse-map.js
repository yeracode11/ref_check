/**
 * Скрывает на карте складской фонд с общим «заглушечным» адресом (даёт кашу в одной точке).
 *
 *   node scripts/reset-generic-warehouse-map.js --city=02 --dry-run
 *   node scripts/reset-generic-warehouse-map.js --city=02 --apply
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Fridge = require('../models/Fridge');
const City = require('../models/City');
const { applyReturnToHomeCity } = require('../lib/fridgeReturnHelpers');
const { isGenericWarehouseAddress } = require('../lib/warehouseAddressHelpers');

async function main() {
  const apply = process.argv.includes('--apply');
  const cityArg = process.argv.find((a) => a.startsWith('--city='));
  const cityCode = cityArg ? cityArg.split('=')[1] : null;

  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

  const cityFilter = cityCode ? { code: cityCode } : {};
  const cities = await City.find(cityFilter).select('name code').lean();

  let scanned = 0;
  let reset = 0;

  for (const city of cities) {
    const fridges = await Fridge.find({
      cityId: city._id,
      active: true,
      warehouseStatus: { $in: ['warehouse', 'returned'] },
      locationAtDepot: false,
    }).select('_id code address location warehouseStatus');

    for (const fridge of fridges) {
      scanned++;
      const generic = await isGenericWarehouseAddress(city._id, fridge.address);
      if (!generic) continue;

      reset++;
      console.log(
        `${apply ? '' : '[dry-run] '}${fridge.code} — общий адрес: ${String(fridge.address).slice(0, 70)}`,
      );

      if (apply) {
        applyReturnToHomeCity(fridge, city);
        await fridge.save();
      }
    }
  }

  console.log(JSON.stringify({ apply, scanned, reset }, null, 2));
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
