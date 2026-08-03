const Fridge = require('../models/Fridge');
const { buildMapLocationFilter } = require('./mapFridgeQuery');
const { resolveCityFilter } = require('./cityScope');
const { getCheckinStatsForFridges } = require('./checkinStatsCache');
const {
  combinedVisitMapStatus,
  getLastVisitFromStatsMap,
  visitStatusFromLastVisit,
  resolveEquipmentStatus,
} = require('./fridgeVisitHelpers');

const MAP_VIEWPORT_MAX_POINTS = parseInt(process.env.MAP_VIEWPORT_MAX_POINTS || '2500', 10);
const MAP_CLUSTER_ZOOM_THRESHOLD = parseInt(process.env.MAP_CLUSTER_ZOOM_THRESHOLD || '14', 10);

function parseBBox(query) {
  const west = parseFloat(query.west);
  const south = parseFloat(query.south);
  const east = parseFloat(query.east);
  const north = parseFloat(query.north);
  if (![west, south, east, north].every(Number.isFinite)) return null;
  if (east <= west || north <= south) return null;
  return {
    west: Math.max(-180, Math.min(180, west)),
    south: Math.max(-90, Math.min(90, south)),
    east: Math.max(-180, Math.min(180, east)),
    north: Math.max(-90, Math.min(90, north)),
  };
}

function parseZoom(query) {
  const z = parseInt(query.zoom, 10);
  if (!Number.isFinite(z)) return 12;
  return Math.min(19, Math.max(3, z));
}

/** Размер ячейки сетки (градусы) для серверной агрегации. */
function gridCellDegrees(zoom) {
  if (zoom >= MAP_CLUSTER_ZOOM_THRESHOLD) return null;
  if (zoom >= 12) return 0.035;
  if (zoom >= 10) return 0.1;
  if (zoom >= 8) return 0.28;
  return 0.65;
}

function buildViewportQuery(user, query, bbox) {
  const filter = {
    active: true,
    ...buildMapLocationFilter(),
    location: {
      $geoWithin: {
        $box: [
          [bbox.west, bbox.south],
          [bbox.east, bbox.north],
        ],
      },
    },
  };

  const scopedCityId = resolveCityFilter(user, query.cityId);
  if (scopedCityId) {
    filter.cityId = scopedCityId;
  }

  return filter;
}

function mapFridgeToMarker(f, statsByFridgeId, now) {
  const { lastVisit, lastFridgeCondition } = getLastVisitFromStatsMap(statsByFridgeId, f);
  const visitStatus = visitStatusFromLastVisit(lastVisit, { nowMs: now, fridgeType: f.type });
  const warehouseStatus = f.warehouseStatus || 'warehouse';
  const status = combinedVisitMapStatus(lastVisit, warehouseStatus, {
    nowMs: now,
    fridgeType: f.type,
  });
  const finalStatus = status === 'location_changed' ? (visitStatus || 'never') : status;

  return {
    type: 'point',
    id: String(f._id),
    code: f.code,
    name: f.name,
    address: f.address || '',
    location: f.location,
    status: finalStatus,
    warehouseStatus,
    visitStatus,
    equipmentStatus: resolveEquipmentStatus(f.status, lastFridgeCondition),
  };
}

function pickClusterStatus(counts) {
  if (counts.broken > 0) return 'broken';
  if (counts.under_repair > 0) return 'under_repair';
  if (counts.old > 0) return 'old';
  if (counts.today > 0 || counts.week > 0) return 'today';
  if (counts.never > 0) return 'never';
  return 'never';
}

async function fetchViewportClusters(filter, bbox, cellSize) {
  const lngSize = cellSize;
  const latSize = cellSize;

  const rows = await Fridge.aggregate([
    { $match: filter },
    {
      $project: {
        lng: { $arrayElemAt: ['$location.coordinates', 0] },
        lat: { $arrayElemAt: ['$location.coordinates', 1] },
        status: 1,
      },
    },
    {
      $group: {
        _id: {
          cx: { $floor: { $divide: ['$lng', lngSize] } },
          cy: { $floor: { $divide: ['$lat', latSize] } },
        },
        count: { $sum: 1 },
        avgLng: { $avg: '$lng' },
        avgLat: { $avg: '$lat' },
        broken: { $sum: { $cond: [{ $eq: ['$status', 'broken'] }, 1, 0] } },
        under_repair: { $sum: { $cond: [{ $eq: ['$status', 'under_repair'] }, 1, 0] } },
      },
    },
    { $limit: 800 },
  ]).allowDiskUse(true);

  return rows.map((row) => {
    const cx = row._id.cx;
    const cy = row._id.cy;
    const west = cx * lngSize;
    const south = cy * latSize;
    const east = west + lngSize;
    const north = south + latSize;

    return {
      type: 'cluster',
      count: row.count,
      location: {
        type: 'Point',
        coordinates: [row.avgLng, row.avgLat],
      },
      status: pickClusterStatus({
        broken: row.broken || 0,
        under_repair: row.under_repair || 0,
        old: 0,
        today: 0,
        week: 0,
        never: row.count - (row.broken || 0) - (row.under_repair || 0),
      }),
      bbox: {
        west: Math.max(bbox.west, west),
        south: Math.max(bbox.south, south),
        east: Math.min(bbox.east, east),
        north: Math.min(bbox.north, north),
      },
    };
  });
}

async function fetchViewportPoints(filter, bbox, zoom) {
  const limit = Math.max(100, Math.min(5000, MAP_VIEWPORT_MAX_POINTS));
  const fridges = await Fridge.find(filter)
    .select('_id code name address location warehouseStatus status type')
    .limit(limit)
    .lean();

  const statsByFridgeId = await getCheckinStatsForFridges(
    fridges,
    JSON.stringify({ viewport: bbox, zoom, n: fridges.length }),
    { useCache: true },
  );

  const now = Date.now();
  const items = fridges.map((f) => mapFridgeToMarker(f, statsByFridgeId, now));

  return {
    mode: 'points',
    items,
    truncated: fridges.length >= limit,
    limit,
  };
}

function buildBulkFilter(user, query) {
  const filter = {
    active: true,
    ...buildMapLocationFilter(),
  };
  const scopedCityId = resolveCityFilter(user, query.cityId);
  if (scopedCityId) {
    filter.cityId = scopedCityId;
  }
  return filter;
}

/**
 * Все точки города (или всех городов для admin) — порциями для lazy load на клиенте.
 */
async function fetchMapFridgeBulk(user, query) {
  const skip = Math.max(0, parseInt(query.skip, 10) || 0);
  const limitRaw = parseInt(query.limit, 10);
  const limit = Math.min(5000, Math.max(100, Number.isFinite(limitRaw) ? limitRaw : 3000));
  const filter = buildBulkFilter(user, query);

  const [total, fridges] = await Promise.all([
    Fridge.countDocuments(filter),
    Fridge.find(filter)
      .select('_id code name address location warehouseStatus status type')
      .sort({ _id: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  const statsByFridgeId = await getCheckinStatsForFridges(
    fridges,
    JSON.stringify({ bulk: true, cityId: query.cityId || 'all', skip, limit }),
    { useCache: true },
  );

  const now = Date.now();
  const items = fridges.map((f) => mapFridgeToMarker(f, statsByFridgeId, now));

  return {
    mode: 'points',
    items,
    total,
    skip,
    limit,
    loaded: skip + items.length,
    hasMore: skip + items.length < total,
  };
}

/**
 * @param {object} user — req.user
 * @param {object} query — req.query (west,south,east,north,zoom,cityId)
 */
async function fetchMapFridgeViewport(user, query) {
  const bbox = parseBBox(query);
  if (!bbox) {
    const err = new Error('Invalid bbox: west, south, east, north required');
    err.status = 400;
    throw err;
  }

  const zoom = parseZoom(query);
  const filter = buildViewportQuery(user, query, bbox);
  const cellSize = gridCellDegrees(zoom);

  if (cellSize == null) {
    return fetchViewportPoints(filter, bbox, zoom);
  }

  const clusters = await fetchViewportClusters(filter, bbox, cellSize);
  return {
    mode: 'clusters',
    items: clusters,
    zoom,
    cellSize,
  };
}

module.exports = {
  parseBBox,
  parseZoom,
  gridCellDegrees,
  fetchMapFridgeViewport,
  fetchMapFridgeBulk,
  MAP_VIEWPORT_MAX_POINTS,
  MAP_CLUSTER_ZOOM_THRESHOLD,
};
