const Checkin = require('../models/Checkin');
const Fridge = require('../models/Fridge');
const User = require('../models/User');
const { getNextSequence } = require('../models/Counter');
const { findRecentDuplicateCheckin } = require('../utils/checkinGeodesic');
const { invalidateCheckinStatsCache } = require('./checkinStatsCache');
const { findFridgeByIdentifier } = require('./cityScope');
const {
  buildCheckinFridgeIdCandidates,
  expandCheckinFridgeIdsForInQuery,
} = require('./fridgeVisitHelpers');
const {
  resolveManagerIdCandidates,
  buildFridgeIdInQueryForDedupe,
  canonicalCheckinFridgeId,
} = require('./checkinDedup');

const CHECKIN_IDEMPOTENCY_WINDOW_MS = (() => {
  const n = parseInt(process.env.CHECKIN_IDEMPOTENCY_WINDOW_MS || '300000', 10);
  return Number.isFinite(n) && n >= 30_000 ? n : 300_000;
})();
const CHECKIN_IDEMPOTENCY_MAX_DISTANCE_M = 40;

function calculateDistanceMeters(loc1, loc2) {
  if (!loc1 || !loc2 || !loc1.coordinates || !loc2.coordinates) {
    return null;
  }
  const [lng1, lat1] = loc1.coordinates;
  const [lng2, lat2] = loc2.coordinates;
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function syncFridgeFromCheckin({
  normalizedFridgeId,
  location,
  fridgeCondition,
  isSeasonalClosure,
  address,
}) {
  const fridge = await Fridge.findOne({
    $or: [
      { code: normalizedFridgeId },
      { number: normalizedFridgeId },
      { 'clientInfo.inn': normalizedFridgeId },
    ],
  });
  if (!fridge) {
    console.warn(`[Checkins] Fridge with code/number/inn ${normalizedFridgeId} not found`);
    return;
  }

  const expandedIds = expandCheckinFridgeIdsForInQuery(
    buildCheckinFridgeIdCandidates(fridge),
  );

  const recentCheckins = await Checkin.find({
    fridgeId: { $in: expandedIds },
  }).sort({ visitedAt: -1 }).limit(2).lean();

  let newWarehouseStatus = fridge.warehouseStatus;
  if (recentCheckins.length === 1) {
    if (fridge.warehouseStatus === 'warehouse' || fridge.warehouseStatus === 'returned') {
      newWarehouseStatus = 'installed';
    }
  } else if (recentCheckins.length >= 2) {
    const secondLastLocation = recentCheckins[1].location;
    const lastLocation = recentCheckins[0].location;
    if (secondLastLocation && lastLocation) {
      const distance = calculateDistanceMeters(secondLastLocation, lastLocation);
      if (distance !== null && distance > 50) {
        newWarehouseStatus = 'moved';
      } else if (fridge.warehouseStatus === 'warehouse' || fridge.warehouseStatus === 'returned') {
        newWarehouseStatus = 'installed';
      } else if (fridge.warehouseStatus === 'moved') {
        newWarehouseStatus = 'installed';
      }
    }
  }

  const fridgeStatusUpdate = {};
  if (fridgeCondition === 'broken') {
    fridgeStatusUpdate.status = 'broken';
    if (!fridge.brokenSince) {
      fridgeStatusUpdate.brokenSince = new Date();
    }
  } else if (fridge.status !== 'under_repair') {
    fridgeStatusUpdate.status = 'working';
    fridgeStatusUpdate.brokenSince = null;
  }

  const seasonalTypes = ['school', 'restricted'];
  if (seasonalTypes.includes(fridge.type)) {
    fridgeStatusUpdate.isSeasonalClosure = isSeasonalClosure;
  }

  await Fridge.findOneAndUpdate(
    {
      $or: [
        { code: normalizedFridgeId },
        { number: normalizedFridgeId },
        { 'clientInfo.inn': normalizedFridgeId },
      ],
    },
    {
      $set: {
        location,
        warehouseStatus: newWarehouseStatus,
        ...(address ? { address } : {}),
        ...fridgeStatusUpdate,
      },
    },
    { new: true },
  );
}

function normalizeLocationInput(location) {
  if (!location) return null;

  let loc = location;
  if (typeof loc === 'string') {
    try {
      loc = JSON.parse(loc);
    } catch {
      return null;
    }
  }

  if (loc && typeof loc.lat !== 'undefined' && typeof loc.lng !== 'undefined') {
    const lat = Number(loc.lat);
    const lng = Number(loc.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { type: 'Point', coordinates: [lng, lat] };
    }
  }

  if (loc?.type === 'Point' && Array.isArray(loc.coordinates) && loc.coordinates.length === 2) {
    return loc;
  }

  return null;
}

function locationFromLatLngFields(body) {
  const lat = body?.lat != null ? Number(body.lat) : NaN;
  const lng = body?.lng != null ? Number(body.lng) : NaN;
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { type: 'Point', coordinates: [lng, lat] };
  }
  return normalizeLocationInput(body?.location);
}

/**
 * @param {object} params
 * @param {object} params.user — req.user
 * @param {string} params.fridgeId
 * @param {object} params.location — GeoJSON Point
 * @param {string[]} [params.photos]
 * @param {string} [params.address]
 * @param {string} [params.notes]
 * @param {string} [params.fridgeCondition]
 * @param {boolean} [params.isSeasonalClosure]
 * @param {string|Date} [params.visitedAt]
 * @param {string} [params.managerIdOverride] — только admin
 */
async function createCheckinRecord(params) {
  const { user } = params;
  if (!user || (user.role !== 'manager' && user.role !== 'admin')) {
    const err = new Error('Only managers can create checkins');
    err.status = 403;
    throw err;
  }

  const managerId = user.role === 'admin' && params.managerIdOverride
    ? params.managerIdOverride
    : (user.username || user.id);

  const normalizedFridgeId = String(params.fridgeId || '').trim().replace(/^#/, '');
  if (!normalizedFridgeId) {
    const err = new Error('fridgeId is required');
    err.status = 400;
    throw err;
  }

  const location = params.location;
  if (!location?.type || !Array.isArray(location.coordinates) || location.coordinates.length !== 2) {
    const err = new Error('location is required');
    err.status = 400;
    throw err;
  }

  const fridgeCondition = params.fridgeCondition === 'broken' ? 'broken' : 'working';
  const isSeasonalClosure = params.isSeasonalClosure === true
    || params.isSeasonalClosure === 'true';

  const [reqLng, reqLat] = location.coordinates;
  const dupWindowStart = new Date(Date.now() - CHECKIN_IDEMPOTENCY_WINDOW_MS);

  const [fridge, managerIdCandidates] = await Promise.all([
    findFridgeByIdentifier(normalizedFridgeId),
    resolveManagerIdCandidates(User, managerId),
  ]);
  const fridgeIdCandidates = fridge
    ? buildCheckinFridgeIdCandidates(fridge)
    : [normalizedFridgeId];
  const storeFridgeId = canonicalCheckinFridgeId(fridge, normalizedFridgeId);

  const recentForDedupe = await Checkin.find({
    ...buildFridgeIdInQueryForDedupe(fridge, normalizedFridgeId),
    visitedAt: { $gte: dupWindowStart },
  })
    .sort({ visitedAt: -1 })
    .limit(30)
    .lean();

  const duplicate = findRecentDuplicateCheckin(recentForDedupe, {
    managerIds: managerIdCandidates,
    fridgeIdCandidates,
    lng: reqLng,
    lat: reqLat,
    now: Date.now(),
    windowMs: CHECKIN_IDEMPOTENCY_WINDOW_MS,
    maxDistanceM: CHECKIN_IDEMPOTENCY_MAX_DISTANCE_M,
  });

  const photos = Array.isArray(params.photos)
    ? params.photos.filter(Boolean).map(String)
    : [];

  if (duplicate && duplicate._id) {
    const existing = await Checkin.findById(duplicate._id);
    if (existing) {
      let changed = false;
      if (existing.fridgeCondition !== fridgeCondition) {
        existing.fridgeCondition = fridgeCondition;
        changed = true;
      }
      if (existing.isSeasonalClosure !== isSeasonalClosure) {
        existing.isSeasonalClosure = isSeasonalClosure;
        changed = true;
      }
      if (photos.length) {
        const merged = [...new Set([...(existing.photos || []), ...photos])];
        if (merged.length !== (existing.photos || []).length) {
          existing.photos = merged;
          changed = true;
        }
      }
      if (changed) await existing.save();

      try {
        await syncFridgeFromCheckin({
          normalizedFridgeId,
          location,
          fridgeCondition,
          isSeasonalClosure,
          address: params.address,
        });
      } catch (updateErr) {
        console.error('Failed to update fridge on idempotent checkin:', updateErr);
      }
      invalidateCheckinStatsCache();
      return {
        checkin: existing.toJSON(),
        status: 200,
        idempotentReplay: true,
      };
    }
  }

  const id = await getNextSequence('checkin');
  const checkin = await Checkin.create({
    id,
    managerId: managerIdCandidates[0] || String(managerId),
    fridgeId: storeFridgeId,
    photos,
    location,
    address: params.address,
    notes: params.notes,
    visitedAt: params.visitedAt ? new Date(params.visitedAt) : undefined,
    fridgeCondition,
    isSeasonalClosure,
  });

  try {
    await syncFridgeFromCheckin({
      normalizedFridgeId,
      location,
      fridgeCondition,
      isSeasonalClosure,
      address: params.address,
    });
  } catch (updateErr) {
    console.error('Failed to update fridge location from checkin:', updateErr);
  }

  invalidateCheckinStatsCache();
  return {
    checkin: checkin.toJSON(),
    status: 201,
    idempotentReplay: false,
  };
}

module.exports = {
  CHECKIN_IDEMPOTENCY_WINDOW_MS,
  CHECKIN_IDEMPOTENCY_MAX_DISTANCE_M,
  syncFridgeFromCheckin,
  normalizeLocationInput,
  locationFromLatLngFields,
  createCheckinRecord,
};
