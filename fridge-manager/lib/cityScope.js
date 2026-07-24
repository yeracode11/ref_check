const mongoose = require('mongoose');
const Fridge = require('../models/Fridge');
const {
  buildCheckinFridgeIdCandidates,
  expandCheckinFridgeIdsForInQuery,
  buildCheckinFridgeIdMatchCondition,
} = require('./fridgeVisitHelpers');
const { fridgeIdMatchesCandidates } = require('./checkinDedup');

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

/** cityId из документа Fridge (Mongoose doc, lean, populate или ObjectId) */
function resolveFridgeCityId(fridgeOrCityId) {
  if (fridgeOrCityId == null) return null;
  if (typeof fridgeOrCityId !== 'object') return fridgeOrCityId;

  const cityRef = fridgeOrCityId.cityId;
  if (cityRef !== undefined) {
    if (cityRef == null) return null;
    if (typeof cityRef === 'object' && cityRef._id != null) {
      return cityRef._id;
    }
    return cityRef;
  }

  if (fridgeOrCityId._id != null && (fridgeOrCityId.name != null || fridgeOrCityId.code != null)) {
    return fridgeOrCityId._id;
  }

  return fridgeOrCityId._id ?? fridgeOrCityId;
}

function userCanAccessFridge(user, fridgeOrCityId) {
  return userCanAccessCity(user, resolveFridgeCityId(fridgeOrCityId));
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

/**
 * Фильтр MongoDB для отметок одного города (fridgeRef + legacy fridgeId в scope города).
 * Не использует общий $in по числовым номерам — иначе одинаковые number в разных городах смешиваются.
 */
async function getCheckinFilterForCity(cityId) {
  if (!cityId) return {};

  const fridges = await Fridge.find(
    { cityId },
    { _id: 1, code: 1, number: 1, 'clientInfo.inn': 1 },
  ).lean();

  if (!fridges.length) {
    return { fridgeId: '__none__' };
  }

  const fridgeObjectIds = fridges.map((f) => f._id);
  const legacyOr = fridges
    .map((f) => buildCheckinFridgeIdMatchCondition(f))
    .filter(Boolean);

  const legacyClause = legacyOr.length === 1
    ? legacyOr[0]
    : { $or: legacyOr };

  return {
    $or: [
      { fridgeRef: { $in: fridgeObjectIds } },
      {
        $and: [
          { $or: [{ fridgeRef: null }, { fridgeRef: { $exists: false } }] },
          legacyClause,
        ],
      },
    ],
  };
}

function invalidateCityCheckinIdsCache(cityId) {
  if (cityId) {
    checkinIdsByCityCache.delete(String(cityId));
    return;
  }
  checkinIdsByCityCache.clear();
}

async function findFridgeByIdentifier(identifier, options = {}) {
  const normalized = String(identifier || '').trim().replace(/^#/, '');
  if (!normalized) return null;

  const query = {
    active: { $ne: false },
    $or: [
      { code: normalized },
      { number: normalized },
      { 'clientInfo.inn': normalized },
    ],
  };

  if (options.cityId) {
    query.cityId = options.cityId;
  }

  const matches = await Fridge.find(query).limit(5).lean();
  if (!matches.length) return null;
  if (matches.length === 1) return matches[0];

  if (options.cityId) {
    return matches[0];
  }

  return null;
}

function buildCheckinFilterForFridge(fridge) {
  const legacy = buildCheckinFridgeIdMatchCondition(fridge);
  if (!fridge?._id) {
    return legacy || { fridgeId: '__none__' };
  }
  return {
    $or: [
      { fridgeRef: fridge._id },
      legacy
        ? {
          $and: [
            { $or: [{ fridgeRef: null }, { fridgeRef: { $exists: false } }] },
            legacy,
          ],
        }
        : { fridgeRef: fridge._id },
    ],
  };
}

module.exports = {
  CITY_SCOPED_ROLES,
  isCityScopedRole,
  getAssignedCityId,
  resolveCityFilter,
  userCanAccessCity,
  resolveFridgeCityId,
  userCanAccessFridge,
  ensureCityScopedUserHasCity,
  getFridgeObjectIdsForCity,
  getCheckinFridgeIdsForCity,
  getCheckinFilterForCity,
  invalidateCityCheckinIdsCache,
  findFridgeByIdentifier,
  buildCheckinFilterForFridge,
};
