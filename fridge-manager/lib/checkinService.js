const Checkin = require('../models/Checkin');
const Fridge = require('../models/Fridge');
const User = require('../models/User');
const City = require('../models/City');
const { getNextSequence } = require('../models/Counter');
const { findRecentDuplicateCheckin } = require('../utils/checkinGeodesic');
const { invalidateCheckinStatsCache } = require('./checkinStatsCache');
const {
  findFridgeByIdentifier,
  getAssignedCityId,
  userCanAccessCity,
  invalidateCityCheckinIdsCache,
  normalizeCityId,
} = require('./cityScope');
const {
  buildCheckinFridgeIdCandidates,
  expandCheckinFridgeIdsForInQuery,
} = require('./fridgeVisitHelpers');
const {
  resolveManagerIdCandidates,
  buildFridgeIdInQueryForDedupe,
  canonicalCheckinFridgeId,
  fridgeIdMatchesCandidates,
} = require('./checkinDedup');
const { isLocationNearCity } = require('./cityLocationValidation');

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
  fridge,
  normalizedFridgeId,
  location,
  fridgeCondition,
  isSeasonalClosure,
  address,
}) {
  let target = fridge;
  if (!target && normalizedFridgeId) {
    target = await findFridgeByIdentifier(normalizedFridgeId);
  }
  if (!target?._id) {
    console.warn(`[Checkins] Fridge not found for sync: ${normalizedFridgeId}`);
    return;
  }

  const fridgeStatusUpdate = {};
  if (fridgeCondition === 'broken') {
    fridgeStatusUpdate.status = 'broken';
    if (!target.brokenSince) {
      fridgeStatusUpdate.brokenSince = new Date();
    }
  } else if (target.status !== 'under_repair') {
    fridgeStatusUpdate.status = 'working';
    fridgeStatusUpdate.brokenSince = null;
  }

  const seasonalTypes = ['school', 'restricted'];
  if (seasonalTypes.includes(target.type)) {
    fridgeStatusUpdate.isSeasonalClosure = isSeasonalClosure;
  }

  const currentWarehouseStatus = target.warehouseStatus || 'warehouse';
  const cityDoc = target.cityId
    ? await City.findById(target.cityId).select('name code').lean()
    : null;
  const checkinInHomeCity = !cityDoc || !location || isLocationNearCity(location, cityDoc);

  // На складе / возврат: GPS на карту только если отметка в регионе «родного» города
  if (currentWarehouseStatus === 'returned' || currentWarehouseStatus === 'warehouse') {
    const update = {
      ...(address ? { address } : {}),
      ...fridgeStatusUpdate,
    };
    if (checkinInHomeCity) {
      update.location = location;
      update.locationAtDepot = false;
    }
    await Fridge.findByIdAndUpdate(target._id, { $set: update }, { new: true });
    return;
  }

  const expandedIds = expandCheckinFridgeIdsForInQuery(
    buildCheckinFridgeIdCandidates(target),
  );

  const recentCheckins = await Checkin.find({
    $or: [
      { fridgeRef: target._id },
      { fridgeId: { $in: expandedIds.length ? expandedIds : [normalizedFridgeId] } },
    ],
  }).sort({ visitedAt: -1 }).limit(2).lean();

  let newWarehouseStatus = target.warehouseStatus;
  if (recentCheckins.length === 1) {
    if (target.warehouseStatus === 'warehouse' || target.warehouseStatus === 'returned') {
      newWarehouseStatus = 'installed';
    }
  } else if (recentCheckins.length >= 2) {
    const secondLastLocation = recentCheckins[1].location;
    const lastLocation = recentCheckins[0].location;
    if (secondLastLocation && lastLocation) {
      const distance = calculateDistanceMeters(secondLastLocation, lastLocation);
      if (distance !== null && distance > 50) {
        newWarehouseStatus = 'moved';
      } else if (target.warehouseStatus === 'warehouse' || target.warehouseStatus === 'returned') {
        newWarehouseStatus = 'installed';
      } else if (target.warehouseStatus === 'moved') {
        newWarehouseStatus = 'installed';
      }
    }
  }

  await Fridge.findByIdAndUpdate(
    target._id,
    {
      $set: {
        location,
        locationAtDepot: false,
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

async function resolveFridgeForCheckin(user, normalizedFridgeId) {
  const fridge = await findFridgeByIdentifier(normalizedFridgeId);
  if (!fridge) {
    const err = new Error(
      'Холодильник не найден. Проверьте код QR или обратитесь к администратору.',
    );
    err.status = 404;
    throw err;
  }

  if (user.role === 'manager') {
    let cityId = getAssignedCityId(user);
    if (!cityId && user.id) {
      const dbUser = await User.findById(user.id).select('cityId').lean();
      cityId = normalizeCityId(dbUser?.cityId);
    }
    if (!cityId) {
      const err = new Error('Для менеджера не назначен город');
      err.status = 403;
      throw err;
    }
    if (!userCanAccessCity(user, fridge.cityId)) {
      const [managerCity, fridgeCity] = await Promise.all([
        City.findById(cityId).select('name').lean(),
        City.findById(fridge.cityId).select('name').lean(),
      ]);
      const err = new Error(
        `Холодильник относится к городу «${fridgeCity?.name || '?'}», а вы — менеджер города «${managerCity?.name || '?'}». Обратитесь к администратору.`,
      );
      err.status = 403;
      throw err;
    }
  }

  return fridge;
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
    resolveFridgeForCheckin(user, normalizedFridgeId),
    resolveManagerIdCandidates(User, managerId),
  ]);
  const fridgeIdCandidates = buildCheckinFridgeIdCandidates(fridge);
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
      if (!existing.fridgeRef && fridge._id) {
        existing.fridgeRef = fridge._id;
        changed = true;
      }
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
          fridge,
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
      invalidateCityCheckinIdsCache(fridge.cityId);
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
    fridgeRef: fridge._id,
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
      fridge,
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
  invalidateCityCheckinIdsCache(fridge.cityId);
  return {
    checkin: checkin.toJSON(),
    status: 201,
    idempotentReplay: false,
  };
}

/** Добавляет fridgeName, fridgeCode, fridgeCity для отображения в списках отметок */
async function enrichCheckinsWithFridgeData(items, toPlain) {
  if (!items.length) return items;

  const fridgeRefIds = [
    ...new Set(
      items
        .map((item) => {
          const plain = toPlain(item);
          return plain.fridgeRef ? String(plain.fridgeRef) : null;
        })
        .filter(Boolean),
    ),
  ];

  const legacyKeys = [
    ...new Set(
      items
        .map((item) => String(toPlain(item).fridgeId || '').trim().replace(/^#/, ''))
        .filter(Boolean),
    ),
  ];

  const byRef = new Map();
  if (fridgeRefIds.length) {
    const fridges = await Fridge.find({ _id: { $in: fridgeRefIds } })
      .populate('cityId', 'name code')
      .select('code number name cityId')
      .lean();
    fridges.forEach((f) => byRef.set(String(f._id), f));
  }

  const byCode = new Map();
  if (legacyKeys.length) {
    const fridges = await Fridge.find({
      $or: [{ code: { $in: legacyKeys } }, { number: { $in: legacyKeys } }],
    })
      .populate('cityId', 'name code')
      .select('code number name cityId')
      .lean();
    fridges.forEach((f) => {
      byCode.set(f.code, f);
      if (f.number) byCode.set(f.number, f);
    });
  }

  return items.map((item) => {
    const plain = toPlain(item);
    let fridge = plain.fridgeRef ? byRef.get(String(plain.fridgeRef)) : null;
    if (!fridge && plain.fridgeId) {
      const key = String(plain.fridgeId).trim().replace(/^#/, '');
      fridge = byCode.get(key) || null;
    }
    const cityRef = fridge?.cityId;
    const fridgeCity =
      cityRef && typeof cityRef === 'object' && cityRef.name ? cityRef.name : undefined;
    return {
      ...plain,
      fridgeName: fridge?.name || undefined,
      fridgeCode: fridge?.code || undefined,
      fridgeCity,
    };
  });
}

module.exports = {
  CHECKIN_IDEMPOTENCY_WINDOW_MS,
  CHECKIN_IDEMPOTENCY_MAX_DISTANCE_M,
  syncFridgeFromCheckin,
  normalizeLocationInput,
  createCheckinRecord,
  resolveFridgeForCheckin,
  enrichCheckinsWithFridgeData,
};
