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
 * - warehouse / returned — только после отметки менеджера (locationAtDepot: false).
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
const FIELD_MAP_WAREHOUSE_STATUSES = ['warehouse', 'installed', 'moved'];

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
