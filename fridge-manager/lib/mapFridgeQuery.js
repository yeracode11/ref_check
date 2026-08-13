/** Фильтр холодильников с координатами для карты (исключает 0,0). */
function buildMapLocationFilter() {
  return {
    location: { $exists: true },
    'location.coordinates.0': { $exists: true, $ne: 0 },
    'location.coordinates.1': { $exists: true, $ne: 0 },
  };
}

/** На карте визитов — только точки у клиентов; склад/возврат в центре города дают «кашу». */
const FIELD_MAP_WAREHOUSE_STATUSES = ['installed', 'moved'];

function buildFieldMapStatusFilter() {
  return { warehouseStatus: { $in: FIELD_MAP_WAREHOUSE_STATUSES } };
}

function applyFieldMapFilters(filter) {
  return {
    ...filter,
    ...buildFieldMapStatusFilter(),
  };
}

function isMapMarkersRequest(query) {
  return query.map === '1' || query.map === 'true';
}

module.exports = {
  buildMapLocationFilter,
  buildFieldMapStatusFilter,
  applyFieldMapFilters,
  FIELD_MAP_WAREHOUSE_STATUSES,
  isMapMarkersRequest,
};
