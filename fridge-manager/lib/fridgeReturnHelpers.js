const { resolveCityMapCenter, cityCenterToGeoPoint } = require('./cityMapCenters');

/** Статусы «на складе» / «возврат» — скрыты на карте до отметки менеджера */
const WAREHOUSE_STATUSES = new Set(['warehouse', 'returned']);

function haversineKm(lat1, lng1, lat2, lng2) {
  const r = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

/** Точка в центре города (заглушка), не реальный адрес / отметка */
function isAtCityDepotCenter(fridge, cityDoc, maxKm = 2) {
  if (!fridge?.location?.coordinates || !cityDoc) return false;
  const center = resolveCityMapCenter(cityDoc.name, cityDoc.code);
  if (!center) return false;
  const [lng, lat] = fridge.location.coordinates;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return haversineKm(lat, lng, center.lat, center.lng) <= maxKm;
}

/**
 * «На складе» и «возврат»: координаты в центр родного города, скрытие на карте до отметки МХО.
 */
function applyReturnToHomeCity(fridge, cityDoc) {
  if (!fridge || !WAREHOUSE_STATUSES.has(fridge.warehouseStatus)) {
    return { applied: false, reason: 'not_warehouse_status' };
  }

  const cityName = cityDoc?.name;
  const cityCode = cityDoc?.code;
  const center = resolveCityMapCenter(cityName, cityCode);
  if (!center) {
    return { applied: false, reason: 'unknown_city_center' };
  }

  fridge.location = cityCenterToGeoPoint(center);
  fridge.locationAtDepot = true;

  if (fridge.warehouseStatus === 'returned') {
    fridge.clientInfo = null;
  }

  return { applied: true, cityName: cityName || null };
}

module.exports = {
  applyReturnToHomeCity,
  WAREHOUSE_STATUSES,
  isAtCityDepotCenter,
};
