/** Фильтр холодильников с координатами для карты (исключает 0,0). */
function buildMapLocationFilter() {
  return {
    location: { $exists: true },
    'location.coordinates.0': { $exists: true, $ne: 0 },
    'location.coordinates.1': { $exists: true, $ne: 0 },
  };
}

function isMapMarkersRequest(query) {
  return query.map === '1' || query.map === 'true';
}

module.exports = {
  buildMapLocationFilter,
  isMapMarkersRequest,
};
