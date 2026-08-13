const { resolveCityMapCenter, cityCenterToGeoPoint } = require('./cityMapCenters');

const WAREHOUSE_STATUSES = new Set(['warehouse', 'returned']);

/**
 * При возврате на склад переносим координаты в центр «родного» города (cityId),
 * иначе точка остаётся у клиента и пропадает с карты / «чужого» региона.
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

  if (fridge.warehouseStatus === 'returned') {
    fridge.clientInfo = null;
  }

  return { applied: true, cityName: cityName || null };
}

module.exports = {
  applyReturnToHomeCity,
  WAREHOUSE_STATUSES,
};
