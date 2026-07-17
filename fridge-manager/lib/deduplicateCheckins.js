const mongoose = require('mongoose');
const City = require('../models/City');
const Fridge = require('../models/Fridge');
const Checkin = require('../models/Checkin');
const User = require('../models/User');
const { haversineMeters } = require('../utils/checkinGeodesic');
const {
  buildCheckinFridgeIdCandidates,
  expandCheckinFridgeIdsForInQuery,
  localDateKeyFromVisit,
  DEFAULT_VISIT_TIMEZONE,
} = require('./fridgeVisitHelpers');
const { normalizeFridgeIdForCompare, resolveManagerIdCandidates } = require('./checkinDedup');
const { escapeRegExp } = require('./stringHelpers');

const WINDOW_MS = parseInt(process.env.CHECKIN_IDEMPOTENCY_WINDOW_MS || '300000', 10);
const MAX_DISTANCE_M = 40;

function coordsOf(checkin) {
  const c = checkin.location?.coordinates;
  if (!c || c.length !== 2) return null;
  return { lng: c[0], lat: c[1] };
}

function isDuplicateOf(keeper, candidate, managerKey) {
  if (normalizeFridgeIdForCompare(keeper.fridgeId) !== normalizeFridgeIdForCompare(candidate.fridgeId)) {
    return false;
  }
  if (keeper._managerKey !== managerKey || candidate._managerKey !== managerKey) {
    return false;
  }
  const t1 = new Date(keeper.visitedAt).getTime();
  const t2 = new Date(candidate.visitedAt).getTime();
  if (!Number.isFinite(t1) || !Number.isFinite(t2) || Math.abs(t2 - t1) > WINDOW_MS) {
    return false;
  }
  const p1 = coordsOf(keeper);
  const p2 = coordsOf(candidate);
  if (!p1 || !p2) return false;
  return haversineMeters(p1.lng, p1.lat, p2.lng, p2.lat) <= MAX_DISTANCE_M;
}

async function buildManagerKeyMap(managerIds) {
  const rawToKey = new Map();
  const unique = [...new Set(managerIds.map((m) => String(m).trim()).filter(Boolean))];

  for (const raw of unique) {
    const candidates = await resolveManagerIdCandidates(User, raw);
    const key = candidates.sort().join('|') || raw;
    for (const c of candidates.length ? candidates : [raw]) {
      rawToKey.set(String(c), key);
    }
    rawToKey.set(raw, key);
  }
  return rawToKey;
}

async function resolveCity({ cityId, cityName }) {
  if (cityId && mongoose.Types.ObjectId.isValid(String(cityId))) {
    const city = await City.findById(cityId).lean();
    if (city) return city;
  }
  if (cityName) {
    const city = await City.findOne({
      name: { $regex: new RegExp(`^${escapeRegExp(String(cityName).trim())}$`, 'i') },
    }).lean();
    if (city) return city;
  }
  return null;
}

function buildDateFilter({ date, today }) {
  let dateKey = date || null;
  if (today) {
    dateKey = localDateKeyFromVisit(new Date(), DEFAULT_VISIT_TIMEZONE);
  }
  if (!dateKey) return { filter: {}, dateKey: null };

  const start = new Date(`${dateKey}T00:00:00+05:00`);
  const end = new Date(`${dateKey}T23:59:59.999+05:00`);
  return {
    filter: { visitedAt: { $gte: start, $lte: end } },
    dateKey,
  };
}

/**
 * @param {{ cityId?: string, cityName?: string, date?: string, today?: boolean, dryRun?: boolean }} opts
 */
async function deduplicateCityCheckins(opts = {}) {
  const dryRun = opts.dryRun !== false;

  const city = await resolveCity(opts);
  if (!city) {
    const all = await City.find({}).select('name code').sort({ name: 1 }).lean();
    const err = new Error(`Город не найден: ${opts.cityName || opts.cityId || '(не указан)'}`);
    err.cities = all;
    throw err;
  }

  const fridges = await Fridge.find({ cityId: city._id }).select('code number clientInfo').lean();
  const fridgeIdList = [];
  fridges.forEach((f) => {
    buildCheckinFridgeIdCandidates(f).forEach((id) => fridgeIdList.push(id));
  });
  const expandedIds = expandCheckinFridgeIdsForInQuery(fridgeIdList);

  const { filter: dateFilter, dateKey } = buildDateFilter(opts);
  const filter = {
    fridgeId: { $in: expandedIds.length ? expandedIds : ['__none__'] },
    ...dateFilter,
  };

  const checkins = await Checkin.find(filter).sort({ visitedAt: 1, id: 1 }).lean();
  const managerKeyMap = await buildManagerKeyMap(checkins.map((c) => c.managerId));
  for (const c of checkins) {
    c._managerKey = managerKeyMap.get(String(c.managerId)) || String(c.managerId);
  }

  const kept = [];
  const toDelete = [];

  for (const c of checkins) {
    const dupOf = kept.find((k) => isDuplicateOf(k, c, c._managerKey));
    if (dupOf) {
      toDelete.push({
        id: c.id,
        visitedAt: c.visitedAt,
        fridgeId: c.fridgeId,
        managerId: c.managerId,
        keeperId: dupOf.id,
      });
    } else {
      kept.push(c);
    }
  }

  let deletedCount = 0;
  if (!dryRun && toDelete.length > 0) {
    const result = await Checkin.deleteMany({ id: { $in: toDelete.map((d) => d.id) } });
    deletedCount = result.deletedCount;
  }

  return {
    city: { id: String(city._id), name: city.name, code: city.code },
    dateKey,
    dryRun,
    windowMs: WINDOW_MS,
    maxDistanceM: MAX_DISTANCE_M,
    totalInScope: checkins.length,
    keptCount: kept.length,
    duplicateCount: toDelete.length,
    deletedCount,
    duplicates: toDelete,
  };
}

module.exports = {
  deduplicateCityCheckins,
  WINDOW_MS,
  MAX_DISTANCE_M,
};
