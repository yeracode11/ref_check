const mongoose = require('mongoose');
const Fridge = require('../models/Fridge');
const {
  buildCheckinFridgeIdCandidates,
  expandCheckinFridgeIdsForInQuery,
  buildCheckinFridgeIdMatchCondition,
} = require('./fridgeVisitHelpers');

/** Роли, привязанные к одному городу (поле user.cityId) */
const CITY_SCOPED_ROLES = ['manager', 'accountant', 'service_manager', 'sales_head'];
const CITY_CHECKIN_IDS_TTL_MS = parseInt(process.env.CITY_CHECKIN_IDS_CACHE_TTL_MS || '300000', 10);
/** @type {Map<string, { ids: string[], at: number }>} */
const checkinIdsByCityCache = new Map();

function isCityScopedRole(role) {
  return CITY_SCOPED_ROLES.includes(role);
}

function getAssignedCityId(user) {
  if (!user?.cityId || !isCityScopedRole(user.role)) return null;
  const id = String(user.cityId);
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : user.cityId;
}

/**
 * Город для фильтрации данных:
 * - admin: из query (или null = все города)
 * - МХО/НОП/бухгалтер/менеджер: только user.cityId
 */
function resolveCityFilter(user, queryCityId) {
  if (!user) return null;
  if (user.role === 'admin') {
    if (queryCityId && mongoose.Types.ObjectId.isValid(String(queryCityId))) {
      return new mongoose.Types.ObjectId(String(queryCityId));
    }
    return null;
  }
  return getAssignedCityId(user);
}

function userCanAccessCity(user, cityId) {
  if (!user || user.role === 'admin') return true;
  const assigned = getAssignedCityId(user);
  if (isCityScopedRole(user.role) && !assigned) return false;
  if (!assigned) return true;
  if (!cityId) return false;
  return String(assigned) === String(cityId);
}

function ensureCityScopedUserHasCity(req, res) {
  if (!req.user || req.user.role === 'admin') return true;
  if (!isCityScopedRole(req.user.role)) return true;
  if (!getAssignedCityId(req.user)) {
    res.status(403).json({
      error: 'Для роли не назначен город. Обратитесь к администратору.',
    });
    return false;
  }
  return true;
}

async function getFridgeObjectIdsForCity(cityId) {
  if (!cityId) return [];
  const fridges = await Fridge.find({ cityId }, { _id: 1 }).lean();
  return fridges.map((f) => f._id);
}

async function getCheckinFridgeIdsForCity(cityId) {
  if (!cityId) return [];

  const cacheKey = String(cityId);
  const cached = checkinIdsByCityCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CITY_CHECKIN_IDS_TTL_MS) {
    return cached.ids;
  }

  const fridges = await Fridge.find(
    { cityId },
    { code: 1, number: 1, 'clientInfo.inn': 1 },
  ).lean();
  const ids = new Set();
  fridges.forEach((f) => {
    buildCheckinFridgeIdCandidates(f).forEach((id) => ids.add(id));
  });
  const expanded = expandCheckinFridgeIdsForInQuery([...ids]);
  checkinIdsByCityCache.set(cacheKey, { ids: expanded, at: Date.now() });
  return expanded;
}

function invalidateCityCheckinIdsCache(cityId) {
  if (cityId) {
    checkinIdsByCityCache.delete(String(cityId));
    return;
  }
  checkinIdsByCityCache.clear();
}

async function findFridgeByIdentifier(identifier) {
  const normalized = String(identifier || '').trim().replace(/^#/, '');
  if (!normalized) return null;
  return Fridge.findOne({
    $or: [
      { code: normalized },
      { number: normalized },
      { 'clientInfo.inn': normalized },
    ],
  }).lean();
}

function buildCheckinFilterForFridge(fridge) {
  const idMatch = buildCheckinFridgeIdMatchCondition(fridge);
  return idMatch || { fridgeId: '__none__' };
}

module.exports = {
  CITY_SCOPED_ROLES,
  isCityScopedRole,
  getAssignedCityId,
  resolveCityFilter,
  userCanAccessCity,
  ensureCityScopedUserHasCity,
  getFridgeObjectIdsForCity,
  getCheckinFridgeIdsForCity,
  invalidateCityCheckinIdsCache,
  findFridgeByIdentifier,
  buildCheckinFilterForFridge,
};
