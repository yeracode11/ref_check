/** Фильтр холодильников с координатами для карты (исключает 0,0). */
function buildMapLocationFilter() {
  return {
    location: { $exists: true },
    'location.coordinates.0': { $exists: true, $ne: 0 },
    'location.coordinates.1': { $exists: true, $ne: 0 },
  };
}

/**
 * На карте:
 * - installed / moved — всегда;
 * - warehouse / returned — только с реальной точкой (отметка менеджера на складе), не заглушка в центре города.
 */
function buildMapVisibleFilter() {
  return {
    $or: [
      { warehouseStatus: { $in: ['installed', 'moved'] } },
      {
        warehouseStatus: { $in: ['warehouse', 'returned'] },
        locationAtDepot: false,
      },
    ],
  };
}

function applyMapVisibleFilters(filter) {
  return {
    ...filter,
    ...buildMapVisibleFilter(),
  };
}

/** @deprecated use buildMapVisibleFilter */
const FIELD_MAP_WAREHOUSE_STATUSES = ['installed', 'moved'];

function buildFieldMapStatusFilter() {
  return buildMapVisibleFilter();
}

function applyFieldMapFilters(filter) {
  return applyMapVisibleFilters(filter);
}

function isMapMarkersRequest(query) {
  return query.map === '1' || query.map === 'true';
}

module.exports = {
  buildMapLocationFilter,
  buildMapVisibleFilter,
  applyMapVisibleFilters,
  buildFieldMapStatusFilter,
  applyFieldMapFilters,
  FIELD_MAP_WAREHOUSE_STATUSES,
  isMapMarkersRequest,
};
