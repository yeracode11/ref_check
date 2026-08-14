/**
 * Сбрасывает GPS вне города: отметка в регионе, заглушечный складской адрес или гeокод.
 * Обрабатывает installed/moved/warehouse/returned — не только склад.
 *
 *   node scripts/fix-far-map-coords.js --city=02 --dry-run
 *   node scripts/fix-far-map-coords.js --city=02 --apply
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Fridge = require('../models/Fridge');
const City = require('../models/City');
const Checkin = require('../models/Checkin');
const { forwardGeocodeQuery, buildGeocodeQuery } = require('../lib/nominatimGeocode');
const { isLocationNearCity } = require('../lib/cityLocationValidation');
const { applyReturnToHomeCity } = require('../lib/fridgeReturnHelpers');
const { isGenericWarehouseAddress, isKnownPlaceholderAddress } = require('../lib/warehouseAddressHelpers');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function lastCheckinLocation(fridgeId) {
  const row = await Checkin.findOne({ fridgeRef: fridgeId })
    .sort({ visitedAt: -1 })
    .select('location')
    .lean();
  return row?.location || null;
}

async function resetToDepot(fridgeDoc, city) {
  const prevStatus = fridgeDoc.warehouseStatus;
  if (prevStatus !== 'warehouse' && prevStatus !== 'returned') {
    fridgeDoc.warehouseStatus = 'warehouse';
  }
  applyReturnToHomeCity(fridgeDoc, city);
  await fridgeDoc.save();
  return 'depot_reset';
}

async function fixFridge(fridge, city, apply) {
  if (isLocationNearCity(fridge.location, city)) {
    return { action: 'skip', reason: 'ok' };
  }

  const checkinLoc = await lastCheckinLocation(fridge._id);
  if (checkinLoc && isLocationNearCity(checkinLoc, city)) {
    if (!apply) return { action: 'checkin_gps', reason: 'checkin_near' };
    await Fridge.updateOne(
      { _id: fridge._id },
      { $set: { location: checkinLoc, locationAtDepot: false } },
    );
    return { action: 'checkin_gps', reason: 'checkin_near' };
  }

  const addr = fridge.address && String(fridge.address).trim();
  const generic = !addr
    || isKnownPlaceholderAddress(addr)
    || await isGenericWarehouseAddress(city._id, addr);

  if (generic) {
    if (!apply) return { action: 'depot_reset', reason: 'generic_address' };
    const doc = await Fridge.findById(fridge._id);
    if (!doc) return { action: 'depot_reset', reason: 'not_found' };
    await resetToDepot(doc, city);
    return { action: 'depot_reset', reason: 'generic_address' };
  }

  if (!apply) return { action: 'geocode', reason: 'far_gps' };

  const query = buildGeocodeQuery(addr, city.name);
  const coords = await forwardGeocodeQuery(query);
  await sleep(1100);

  if (coords && isLocationNearCity({ type: 'Point', coordinates: coords }, city)) {
    await Fridge.updateOne(
      { _id: fridge._id },
      { $set: { location: { type: 'Point', coordinates: coords }, locationAtDepot: false } },
    );
    return { action: 'geocode', reason: 'geocoded' };
  }

  const doc = await Fridge.findById(fridge._id);
  if (doc) {
    await resetToDepot(doc, city);
    return { action: 'depot_reset', reason: 'geocode_failed' };
  }
  return { action: 'depot_reset', reason: 'geocode_failed' };
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

  const stats = { scanned: 0, far: 0, byAction: {} };

  for (const city of cities) {
    const fridges = await Fridge.find({
      cityId: city._id,
      active: true,
      'location.coordinates.0': { $exists: true, $ne: 0 },
      'location.coordinates.1': { $exists: true, $ne: 0 },
    }).select('_id code address location warehouseStatus locationAtDepot').lean();

    for (const f of fridges) {
      stats.scanned += 1;
      if (isLocationNearCity(f.location, city)) continue;

      stats.far += 1;
      const result = await fixFridge(f, city, apply);
      stats.byAction[result.action] = (stats.byAction[result.action] || 0) + 1;
      console.log(
        `${apply ? '' : '[dry-run] '}${f.code} (${f.warehouseStatus}) — ${result.action}/${result.reason}`,
      );
    }
  }

  console.log(JSON.stringify({ apply, ...stats }, null, 2));
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
